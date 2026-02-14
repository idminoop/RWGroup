const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const GEOCODE_API = '/api/geocode'
const DEFAULT_RADIUS = 1500 // meters
const REQUEST_TIMEOUT_MS = 12000
const CACHE_TTL_MS = 10 * 60 * 1000
const FAILURE_COOLDOWN_MS = 90 * 1000
const RETRY_DELAY_MS = 300
const OVERPASS_RESULT_LIMIT = 90
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const ROAD_NAME_RX = /(?:\u0443\u043b(?:\u0438\u0446\u0430)?|\u043f\u0440\u043e\u0441\u043f\u0435\u043a\u0442|\u043f\u0440-\u0442|\u0448\u043e\u0441\u0441\u0435|\u0434\u043e\u0440\u043e\u0433\u0430|\u043f\u0440\u043e\u0435\u0437\u0434|\u0431\u0443\u043b\u044c\u0432\u0430\u0440|\u043d\u0430\u0431\u0435\u0440\u0435\u0436\u043d\u0430\u044f|street|road|avenue|highway)/i

export type PoiResult = { name: string; lat: number; lon: number; tags?: Record<string, string> }
export type GeoCoords = { lat: number; lon: number; score?: number }

type OverpassElement = {
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
}

type OverpassResponse = {
  elements?: OverpassElement[]
}

type CacheRecord = {
  results: PoiResult[]
  expiresAt: number
}

type HttpStatusError = Error & { status?: number }

const CATEGORY_QUERIES: Record<string, string> = {
  sport: 'node["leisure"~"fitness_centre|sports_centre|stadium"](around:{RADIUS},{LAT},{LON});way["leisure"~"fitness_centre|sports_centre|stadium"](around:{RADIUS},{LAT},{LON});',
  kids: 'node["amenity"="kindergarten"](around:{RADIUS},{LAT},{LON});way["amenity"="kindergarten"](around:{RADIUS},{LAT},{LON});',
  market: 'node["shop"="supermarket"](around:{RADIUS},{LAT},{LON});way["shop"="supermarket"](around:{RADIUS},{LAT},{LON});',
  school: 'node["amenity"="school"](around:{RADIUS},{LAT},{LON});way["amenity"="school"](around:{RADIUS},{LAT},{LON});',
  fun: 'node["amenity"~"cinema|theatre|arts_centre|museum"](around:{RADIUS},{LAT},{LON});node["tourism"~"attraction|museum|gallery|viewpoint"](around:{RADIUS},{LAT},{LON});way["tourism"~"attraction|museum|gallery|viewpoint"](around:{RADIUS},{LAT},{LON});',
  church: 'node["amenity"="place_of_worship"](around:{RADIUS},{LAT},{LON});way["amenity"="place_of_worship"](around:{RADIUS},{LAT},{LON});',
  cafe: 'node["amenity"~"cafe|restaurant"](around:{RADIUS},{LAT},{LON});',
  metro: 'node["station"="subway"](around:{RADIUS},{LAT},{LON});',
  parks: 'node["leisure"="park"](around:{RADIUS},{LAT},{LON});way["leisure"="park"](around:{RADIUS},{LAT},{LON});',
  mall: 'node["shop"="mall"](around:{RADIUS},{LAT},{LON});way["shop"="mall"](around:{RADIUS},{LAT},{LON});',
  business: 'node["office"]["name"](around:{RADIUS},{LAT},{LON});way["office"]["name"](around:{RADIUS},{LAT},{LON});node["amenity"="business_centre"]["name"](around:{RADIUS},{LAT},{LON});way["amenity"="business_centre"]["name"](around:{RADIUS},{LAT},{LON});node["building"="office"]["name"](around:{RADIUS},{LAT},{LON});way["building"="office"]["name"](around:{RADIUS},{LAT},{LON});',
  theatre: 'node["amenity"="theatre"](around:{RADIUS},{LAT},{LON});way["amenity"="theatre"](around:{RADIUS},{LAT},{LON});',
  university: 'node["amenity"="university"](around:{RADIUS},{LAT},{LON});way["amenity"="university"](around:{RADIUS},{LAT},{LON});',
}

const cache = new Map<string, CacheRecord>()
const inflight = new Map<string, Promise<PoiResult[]>>()
const failedUntil = new Map<string, number>()

function cacheKey(lat: number, lon: number, category: string, radiusMeters: number) {
  return `${lat.toFixed(4)}-${lon.toFixed(4)}-${category}-${Math.round(radiusMeters)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function endpointOrderByKey(key: string): string[] {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  const offset = Math.abs(hash) % OVERPASS_ENDPOINTS.length
  return [...OVERPASS_ENDPOINTS.slice(offset), ...OVERPASS_ENDPOINTS.slice(0, offset)]
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function parseOverpass(json: OverpassResponse): PoiResult[] {
  const elements = Array.isArray(json.elements) ? json.elements : []
  return elements
    .map((el) => {
      const elLat = el.lat ?? el.center?.lat
      const elLon = el.lon ?? el.center?.lon
      if (typeof elLat !== 'number' || typeof elLon !== 'number') return null
      return {
        name: el.tags?.name || el.tags?.['name:ru'] || '',
        lat: elLat,
        lon: elLon,
        tags: el.tags,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

function filterAndDedupeByDistance(
  points: PoiResult[],
  originLat: number,
  originLon: number,
  radiusMeters: number,
  category: string
): PoiResult[] {
  const distanceLimit = Math.max(300, Math.round(radiusMeters * 1.25))
  const result: PoiResult[] = []
  const seen = new Set<string>()

  for (const point of points) {
    const name = (point.name || '').trim()
    const tags = point.tags || {}

    if (category !== 'metro' && !name) continue
    if (typeof tags.highway === 'string') continue

    if (category === 'business') {
      const businessLike =
        typeof tags.office === 'string'
        || tags.amenity === 'business_centre'
        || tags.building === 'office'
      if (!businessLike) continue
      if (ROAD_NAME_RX.test(name)) continue
    }

    const distance = distanceMeters(originLat, originLon, point.lat, point.lon)
    if (!Number.isFinite(distance) || distance > distanceLimit) continue
    const key = `${name.toLowerCase()}|${point.lat.toFixed(5)}|${point.lon.toFixed(5)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(point)
  }

  return result
}

function buildOverpassQuery(template: string, lat: number, lon: number, radius: number): string {
  const body = template
    .replace(/\{LAT\}/g, String(lat))
    .replace(/\{LON\}/g, String(lon))
    .replace(/\{RADIUS\}/g, String(radius))
  return `[out:json][timeout:10];(${body});out center ${OVERPASS_RESULT_LIMIT};`
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function requestOverpass(endpoint: string, query: string): Promise<PoiResult[]> {
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    REQUEST_TIMEOUT_MS
  )

  if (!response.ok) {
    const err = new Error(`Overpass API error: ${response.status}`) as HttpStatusError
    err.status = response.status
    throw err
  }

  const json = await response.json() as OverpassResponse
  return parseOverpass(json)
}

async function fetchPOIsInternal(
  lat: number,
  lon: number,
  category: string,
  normalizedRadius: number,
  key: string
): Promise<PoiResult[]> {
  const template = CATEGORY_QUERIES[category]
  if (!template) return []

  const now = Date.now()
  const cooldown = failedUntil.get(key)
  if (typeof cooldown === 'number' && cooldown > now) return []

  const radii = [normalizedRadius]
  if (normalizedRadius > 1300) {
    radii.push(Math.max(700, Math.round(normalizedRadius * 0.65)))
  }

  const endpoints = endpointOrderByKey(key)

  for (const radius of radii) {
    const query = buildOverpassQuery(template, lat, lon, radius)
    for (const endpoint of endpoints) {
      try {
        const results = await requestOverpass(endpoint, query)
        const normalized = filterAndDedupeByDistance(results, lat, lon, radius, category)
        cache.set(key, { results: normalized, expiresAt: Date.now() + CACHE_TTL_MS })
        failedUntil.delete(key)
        return normalized
      } catch (error) {
        const status = (error as HttpStatusError)?.status
        const retryable = typeof status === 'number' ? RETRYABLE_HTTP_STATUSES.has(status) : true

        if (!retryable) {
          failedUntil.set(key, Date.now() + FAILURE_COOLDOWN_MS)
          return []
        }

        if (status === 429) await sleep(RETRY_DELAY_MS * 2)
        else await sleep(RETRY_DELAY_MS)
      }
    }
  }

  failedUntil.set(key, Date.now() + FAILURE_COOLDOWN_MS)
  return []
}

export async function fetchPOIs(
  lat: number,
  lon: number,
  category: string,
  radiusMeters = DEFAULT_RADIUS
): Promise<PoiResult[]> {
  const normalizedRadius = Math.max(300, Math.round(radiusMeters))
  const key = cacheKey(lat, lon, category, normalizedRadius)
  const now = Date.now()

  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.results

  const pending = inflight.get(key)
  if (pending) return pending

  const request = fetchPOIsInternal(lat, lon, category, normalizedRadius, key).finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, request)
  return request
}

const geocodeCache = new Map<string, GeoCoords | null>()

type GeocodeAddressOptions = {
  city?: string
  complexName?: string
}

type GeocodeApiResponse = {
  success: boolean
  data: {
    lat: number
    lon: number
    score?: number
    display_name?: string
  } | null
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of items) {
    const value = item.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function normalizeNameForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasAddressHint(value: string): boolean {
  if (!value.trim()) return false
  const hasHouseNumber = /\b\d+[a-z\u0430-\u044f]?\b/iu.test(value)
  const hasStreetKeyword = /\b(?:\u0443\u043b(?:\.|\u0438\u0446\u0430)?|\u043f\u0440(?:-|\.)?|\u043f\u0440\u043e\u0441\u043f(?:\.|\u0435\u043a\u0442)?|\u043f\u0435\u0440(?:\.|\u0435\u0443\u043b\u043e\u043a)?|\u043d\u0430\u0431(?:\.|\u0435\u0440\u0435\u0436\u043d\u0430\u044f)?|\u0448\u043e\u0441\u0441\u0435|\u0431\u0443\u043b(?:\.|\u044c\u0432\u0430\u0440)?|street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?)\b/iu.test(value)
  return hasHouseNumber || hasStreetKeyword
}

function queryContainsComplexName(query: string, complexName: string): boolean {
  const queryNorm = normalizeNameForCompare(query)
  const complexNorm = normalizeNameForCompare(complexName)
  if (!queryNorm || !complexNorm) return false
  return queryNorm.includes(complexNorm)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripComplexNameFromAddress(raw: string, complexName: string): string {
  let value = raw.replace(/\s+/g, ' ').trim()
  if (!value) return ''

  value = value.replace(/^\s*(?:\u0436\u043a|\u0436\u0438\u043b\u043e\u0439\s+\u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441)\s+/iu, '').trim()

  const cleanComplexName = complexName.trim()
  if (cleanComplexName) {
    const escaped = escapeRegExp(cleanComplexName)
    value = value.replace(new RegExp(`^${escaped}\\s*[,\\-–—]?\\s*`, 'iu'), '').trim()
  }

  const parts = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (parts.length > 1 && !hasAddressHint(parts[0])) {
    const firstAddressPart = parts.findIndex((item) => hasAddressHint(item))
    if (firstAddressPart > 0) {
      value = parts.slice(firstAddressPart).join(', ')
    }
  }

  return value.trim()
}

function normalizeAddress(raw: string): string[] {
  const compact = raw.replace(/\s+/g, ' ').trim()
  if (!compact) return []

  const withoutBuildingPart = compact
    .replace(/\b(?:\u0441\u0442\u0440\u043e\u0435\u043d\u0438\u0435|\u0441\u0442\u0440\.?|\u043a\u043e\u0440\u043f\u0443\u0441|\u043a\u043e\u0440\u043f\.?|\u043a)\s*\d+[\u0430-\u044fa-z]?/giu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const withoutHouseNumber = compact
    .replace(/\s*\d+[\u0430-\u044fa-z]?\s*$/iu, '')
    .trim()

  return uniqStrings([compact, withoutBuildingPart, withoutHouseNumber])
}

async function nominatimSearch(
  query: string,
  options?: { city?: string; moscowFirst?: boolean }
): Promise<GeoCoords | null> {
  const params = new URLSearchParams({ q: query })
  if (options?.city) params.set('city', options.city)
  if (options?.moscowFirst) params.set('moscowFirst', '1')

  const response = await fetch(`${GEOCODE_API}?${params}`)
  if (!response.ok) return null

  const json = await response.json() as GeocodeApiResponse
  const data = json?.data
  if (!data) return null

  if (!Number.isFinite(data.lat) || !Number.isFinite(data.lon)) return null

  return {
    lat: data.lat,
    lon: data.lon,
    score: Number.isFinite(data.score) ? data.score : 0,
  }
}

function geocodeDistanceMeters(a: GeoCoords, b: GeoCoords): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa))
  return earthRadius * c
}

async function findBestGeocodeCandidate(
  queries: string[],
  options: { city?: string; moscowFirst?: boolean },
  minQueriesBeforeBreak = 1
): Promise<GeoCoords | null> {
  const list = uniqStrings(queries).filter(Boolean)
  if (!list.length) return null

  let best: GeoCoords | null = null
  for (let i = 0; i < list.length; i += 1) {
    const result = await nominatimSearch(list[i], options)
    if (result && (!best || (result.score || 0) > (best.score || 0))) {
      best = result
    }
    if (best && (best.score || 0) >= 175 && i + 1 >= minQueriesBeforeBreak) break
  }

  return best
}

export async function geocodeAddress(
  address: string,
  options: string | GeocodeAddressOptions = 'Moscow'
): Promise<GeoCoords | null> {
  const normalizedOptions: GeocodeAddressOptions =
    typeof options === 'string' ? { city: options } : options

  const rawAddress = address.trim()
  const cityLabel = (normalizedOptions.city || 'Moscow').trim()
  const complexNameRaw = (normalizedOptions.complexName || '').trim()
  const complexName = complexNameRaw.replace(/^(?:\u0416\u041a|\u0436\u043a)\s+/u, '').replace(/\s+\u043d\u0430\s+\u043a\u0430\u0440\u0442\u0435$/iu, '').trim()
  const addressLooksExplicit = hasAddressHint(rawAddress)
  const containsComplexName = complexName ? queryContainsComplexName(rawAddress, complexName) : false
  const shouldInjectComplexName = Boolean(complexName) && (!addressLooksExplicit || containsComplexName)
  const strippedAddress = stripComplexNameFromAddress(rawAddress, complexName)

  const key = `${address}|${cityLabel}|${shouldInjectComplexName ? complexName : ''}|${addressLooksExplicit ? 'addr' : 'name'}`
  const cached = geocodeCache.get(key)
  if (cached !== undefined) return cached

  const addressVariants = uniqStrings([
    ...normalizeAddress(strippedAddress || rawAddress),
    ...normalizeAddress(rawAddress),
  ])
  const nameVariants = shouldInjectComplexName
    ? uniqStrings([complexNameRaw, complexName, `\u0416\u041a ${complexName}`])
    : []

  const topAddress = addressVariants[0] || strippedAddress || rawAddress
  const secondaryAddress = addressVariants[1] || ''
  const addressWithoutHouse = addressVariants[2] || ''
  if (!topAddress && !nameVariants[0]) {
    geocodeCache.set(key, null)
    return null
  }

  const cityLc = cityLabel.toLowerCase()
  const isMoscow = /(?:\u043c\u043e\u0441\u043a|moscow)/i.test(cityLc)
  const searchOptions = {
    city: cityLabel || undefined,
    moscowFirst: isMoscow,
  }

  let best: GeoCoords | null = null
  if (addressLooksExplicit) {
    const addressQueries = uniqStrings([
      topAddress,
      secondaryAddress,
      addressWithoutHouse,
      cityLabel && topAddress ? `${topAddress}, ${cityLabel}` : '',
    ]).slice(0, 6)
    best = await findBestGeocodeCandidate(addressQueries, searchOptions, Math.min(3, addressQueries.length))

    if (best && shouldInjectComplexName && complexName) {
      const refineQueries = uniqStrings([
        `${complexName}, ${topAddress}`,
        `${topAddress}, ${complexName}`,
        nameVariants[0] || '',
      ]).slice(0, 4)

      const maxRefineDistanceMeters = 2000
      let refined = best
      for (const query of refineQueries) {
        const candidate = await nominatimSearch(query, searchOptions)
        if (!candidate) continue
        const distance = geocodeDistanceMeters(best, candidate)
        if (!Number.isFinite(distance) || distance > maxRefineDistanceMeters) continue
        const candidateScore = candidate.score || 0
        const refinedScore = refined.score || 0
        if (candidateScore > refinedScore + 2) {
          refined = candidate
        }
      }
      best = refined
    }

    if (!best && shouldInjectComplexName && complexName) {
      const fallbackQueries = uniqStrings([
        `${complexName}, ${topAddress}`,
        `${topAddress}, ${complexName}`,
        nameVariants[0] || '',
      ])
      best = await findBestGeocodeCandidate(fallbackQueries, searchOptions, Math.min(2, fallbackQueries.length))
    }
  } else {
    const nameFirstQueries = uniqStrings([
      topAddress && complexName ? `${complexName}, ${topAddress}` : '',
      topAddress && complexName ? `${topAddress}, ${complexName}` : '',
      topAddress,
      secondaryAddress,
      nameVariants[0] || '',
    ]).slice(0, 5)
    best = await findBestGeocodeCandidate(nameFirstQueries, searchOptions, 1)
  }

  geocodeCache.set(key, best)
  return best
}
