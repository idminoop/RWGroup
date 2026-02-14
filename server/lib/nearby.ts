import type { Complex, ComplexNearbyPlace } from '../../shared/types.js'
import { slugify } from './ids.js'

type Coords = { lat: number; lon: number }

type CategoryDef = {
  key: string
  label: string
  query: string
  fallbackImages: string[]
}

type PoiWithMeta = {
  name: string
  lat: number
  lon: number
  tags?: Record<string, string>
  category: CategoryDef
  distanceKm: number
}

type RoutedPoi = PoiWithMeta & {
  walkMinutes: number
  driveMinutes: number
  interestScore: number
}

type OverpassElement = {
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
}

type OverpassResponse = {
  elements?: OverpassElement[]
}

type OverpassCacheRecord = {
  results: Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>
  expiresAt: number
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const OSRM_BASE_URL = 'https://router.project-osrm.org'

const USER_AGENT = 'RWGroupWebsite/1.0 (+nearby-generator)'
const OVERPASS_TIMEOUT_MS = 12000
const OVERPASS_CACHE_TTL_MS = 8 * 60 * 1000
const OVERPASS_FAILURE_COOLDOWN_MS = 70 * 1000
const OVERPASS_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const OVERPASS_RETRY_DELAY_MS = 300
const OVERPASS_RESULT_LIMIT = 120
const MOSCOW_BOUNDS = {
  minLat: 55.0,
  maxLat: 56.2,
  minLon: 36.7,
  maxLon: 38.3,
}
const MOSCOW_VIEWBOX = `${MOSCOW_BOUNDS.minLon},${MOSCOW_BOUNDS.maxLat},${MOSCOW_BOUNDS.maxLon},${MOSCOW_BOUNDS.minLat}`
const MOSCOW_LABEL = '\u041c\u043e\u0441\u043a\u0432\u0430'

const SEARCH_RADIUS_METERS = 2600
const MAX_ITEMS = 20
const MAX_PER_CATEGORY = 12
const MAX_CANDIDATES_BEFORE_ROUTES = 110
const MAX_MINUTES = 20
const IMAGE_VARIANTS_LIMIT = 24
const IMAGE_RESOLVE_CONCURRENCY = 4
const MIN_ROUTED_CANDIDATES = 8
const IMAGE_GEOSEARCH_RADIUS_METERS = 420
const IMAGE_GEOSEARCH_LIMIT = 14
const IMAGE_GEOSEARCH_WIDE_RADIUS_METERS = 900
const IMAGE_GEOSEARCH_WIDE_LIMIT = 12

const CATEGORY_BASE_SCORE: Record<string, number> = {
  theatre: 4.6,
  fun: 4.2,
  parks: 3.6,
  metro: 3.4,
  church: 3.1,
  mall: 2.7,
  sport: 2.5,
}

const CATEGORY_HARD_LIMIT: Record<string, number> = {
  theatre: 4,
  fun: 5,
  parks: 5,
  metro: 4,
  church: 3,
  mall: 4,
  sport: 4,
}
const DEFAULT_CATEGORY_HARD_LIMIT = 4
const GENERIC_PLACE_NAME_RX = /^(park|mall|museum|theatre|cinema|church|center|centre|парк|музей|театр|кинотеатр|храм|церковь|центр|сквер)$/i

const FALLBACK_WALK_M_PER_MIN = 75
const FALLBACK_DRIVE_M_PER_MIN = 450

const overpassCache = new Map<string, OverpassCacheRecord>()
const overpassInFlight = new Map<string, Promise<Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>>>()
const overpassFailedUntil = new Map<string, number>()
const geocodeCache = new Map<string, Coords | null>()
const commonsFileThumbCache = new Map<string, string | null>()
const wikidataImageFileCache = new Map<string, string | null>()
const wikidataCommonsCategoryCache = new Map<string, string | null>()
const wikipediaThumbCache = new Map<string, string | null>()
const commonsSearchCache = new Map<string, string[]>()
const commonsGeoSearchCache = new Map<string, string[]>()
const commonsCategorySearchCache = new Map<string, string[]>()
const wikipediaSearchCache = new Map<string, string[]>()
const wikipediaGeoSearchCache = new Map<string, string[]>()
const openverseSearchCache = new Map<string, string[]>()

const CATEGORIES: CategoryDef[] = [
  {
    key: 'parks',
    label: 'Park',
    query: 'node["leisure"="park"](around:{RADIUS},{LAT},{LON});way["leisure"="park"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'metro',
    label: 'Metro',
    query: 'node["station"="subway"](around:{RADIUS},{LAT},{LON});node["railway"="station"]["station"~"subway|metro"](around:{RADIUS},{LAT},{LON});node["public_transport"="station"]["subway"="yes"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1508179522353-11ba468c4a1c?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'sport',
    label: 'Sport',
    query: 'node["leisure"~"fitness_centre|sports_centre|stadium"](around:{RADIUS},{LAT},{LON});way["leisure"~"fitness_centre|sports_centre|stadium"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1486286701208-1d58e9338013?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'fun',
    label: 'Culture',
    query: 'node["amenity"~"cinema|theatre|arts_centre|museum"](around:{RADIUS},{LAT},{LON});node["tourism"~"attraction|museum|gallery|viewpoint"](around:{RADIUS},{LAT},{LON});way["tourism"~"attraction|museum|gallery|viewpoint"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1577083552431-6e5fd01988f1?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'theatre',
    label: 'Theatre',
    query: 'node["amenity"="theatre"](around:{RADIUS},{LAT},{LON});way["amenity"="theatre"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1503095396549-807759245b35?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'church',
    label: 'Architecture',
    query: 'node["amenity"="place_of_worship"](around:{RADIUS},{LAT},{LON});way["amenity"="place_of_worship"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1513326738677-b964603b136d?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1465447142348-e9952c393450?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'mall',
    label: 'Mall',
    query: 'node["shop"="mall"](around:{RADIUS},{LAT},{LON});way["shop"="mall"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1400&q=80',
    ],
  },
]

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function toRad(value: number): number {
  return (value * Math.PI) / 180
}

function distanceKm(a: Coords, b: Coords): number {
  const earth = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const acc =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return earth * 2 * Math.atan2(Math.sqrt(acc), Math.sqrt(1 - acc))
}

function poiKey(item: { name: string; lat: number; lon: number }): string {
  const normalized = normalizeName(item.name)
  return `${normalized || 'poi'}|${item.lat.toFixed(5)}|${item.lon.toFixed(5)}`
}

function isGenericPlaceName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return true
  const normalized = normalizeName(trimmed).replace(/[.,'"`!?()-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return true
  if (GENERIC_PLACE_NAME_RX.test(normalized)) return true
  if (/^\d+$/.test(normalized)) return true
  return false
}

function safeTag(tags: Record<string, string> | undefined, key: string): string {
  const value = tags?.[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function categoryHardLimit(categoryKey: string): number {
  return CATEGORY_HARD_LIMIT[categoryKey] || DEFAULT_CATEGORY_HARD_LIMIT
}

function scorePoi(item: PoiWithMeta & { walkMinutes: number; driveMinutes: number }): number {
  const tags = item.tags || {}
  let score = CATEGORY_BASE_SCORE[item.category.key] || 2.3

  const hasWikiRef = Boolean(
    safeTag(tags, 'wikipedia')
    || safeTag(tags, 'wikidata')
    || safeTag(tags, 'wikimedia_commons')
  )
  if (hasWikiRef) score += 2.3

  const amenity = safeTag(tags, 'amenity')
  const tourism = safeTag(tags, 'tourism')
  const leisure = safeTag(tags, 'leisure')
  const historic = safeTag(tags, 'historic')
  const heritage = safeTag(tags, 'heritage')

  if (historic || heritage) score += 1.6
  if (tourism === 'attraction' || tourism === 'museum' || tourism === 'gallery' || tourism === 'viewpoint') score += 1.4
  if (amenity === 'museum' || amenity === 'theatre' || amenity === 'cinema') score += 1.1
  if (leisure === 'park') score += 0.7

  if (safeTag(tags, 'brand') || safeTag(tags, 'operator')) score += 0.3
  if (item.name.trim().length >= 16) score += 0.3
  if (isGenericPlaceName(item.name)) score -= 1.8

  const bestTravel = Math.min(item.walkMinutes * 0.95, item.driveMinutes * 1.1)
  score += Math.max(-1.5, 4.6 - bestTravel / 4.4)
  score += Math.max(-1.3, 2.0 - item.distanceKm * 0.85)

  return score
}

function pickInterestingCandidates(items: Array<PoiWithMeta & { walkMinutes: number; driveMinutes: number }>, maxItems: number): RoutedPoi[] {
  const scored = items
    .map((item) => ({
      ...item,
      interestScore: scorePoi(item),
    }))
    .sort((a, b) => {
      if (b.interestScore !== a.interestScore) return b.interestScore - a.interestScore
      if (a.walkMinutes !== b.walkMinutes) return a.walkMinutes - b.walkMinutes
      if (a.driveMinutes !== b.driveMinutes) return a.driveMinutes - b.driveMinutes
      return a.distanceKm - b.distanceKm
    })

  const selected: RoutedPoi[] = []
  const selectedKeys = new Set<string>()
  const perCategory = new Map<string, number>()

  const pushCandidate = (item: RoutedPoi, categoryCap: number): boolean => {
    const key = poiKey(item)
    if (selectedKeys.has(key)) return false
    const categoryCount = perCategory.get(item.category.key) || 0
    if (categoryCount >= categoryCap) return false
    selected.push(item)
    selectedKeys.add(key)
    perCategory.set(item.category.key, categoryCount + 1)
    return true
  }

  const bestPerCategory = new Map<string, RoutedPoi>()
  for (const item of scored) {
    if (!bestPerCategory.has(item.category.key)) {
      bestPerCategory.set(item.category.key, item)
    }
  }
  const categorySeeds = Array.from(bestPerCategory.values()).sort((a, b) => b.interestScore - a.interestScore)
  for (const item of categorySeeds) {
    if (selected.length >= maxItems) break
    pushCandidate(item, 1)
  }

  const passes = [2, 3, 4, 5]
  for (const passCap of passes) {
    for (const item of scored) {
      if (selected.length >= maxItems) break
      const cap = Math.min(passCap, categoryHardLimit(item.category.key))
      pushCandidate(item, cap)
    }
    if (selected.length >= maxItems) break
  }

  if (selected.length < maxItems) {
    for (const item of scored) {
      if (selected.length >= maxItems) break
      pushCandidate(item, categoryHardLimit(item.category.key))
    }
  }

  return selected.slice(0, maxItems)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return []
  const out: R[] = new Array(items.length)
  const workers = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        out[index] = await worker(items[index], index)
      }
    })
  )

  return out
}

function isWithinMoscowBounds(point: Coords): boolean {
  return point.lat >= MOSCOW_BOUNDS.minLat
    && point.lat <= MOSCOW_BOUNDS.maxLat
    && point.lon >= MOSCOW_BOUNDS.minLon
    && point.lon <= MOSCOW_BOUNDS.maxLon
}

function filterPoisByDistance(
  origin: Coords,
  points: Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>,
  radiusMeters: number
): Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }> {
  const distanceLimitKm = Math.max(0.3, (radiusMeters * 1.25) / 1000)
  const seen = new Set<string>()
  const output: Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }> = []

  for (const item of points) {
    const dist = distanceKm(origin, { lat: item.lat, lon: item.lon })
    if (!Number.isFinite(dist) || dist > distanceLimitKm) continue
    const key = `${normalizeName(item.name)}|${item.lat.toFixed(5)}|${item.lon.toFixed(5)}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }

  return output
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

function overpassKey(origin: Coords, categoryKey: string, radius: number): string {
  return `${origin.lat.toFixed(4)}:${origin.lon.toFixed(4)}:${categoryKey}:${Math.round(radius)}`
}

function overpassQuery(template: string, origin: Coords, radius: number): string {
  const body = template
    .replace(/\{LAT\}/g, String(origin.lat))
    .replace(/\{LON\}/g, String(origin.lon))
    .replace(/\{RADIUS\}/g, String(Math.round(radius)))
  return `[out:json][timeout:10];(${body});out center ${OVERPASS_RESULT_LIMIT};`
}

function endpointOrder(key: string): string[] {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  const offset = Math.abs(hash) % OVERPASS_ENDPOINTS.length
  return [...OVERPASS_ENDPOINTS.slice(offset), ...OVERPASS_ENDPOINTS.slice(0, offset)]
}

async function requestOverpass(endpoint: string, query: string): Promise<Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>> {
  const response = await withTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    },
    OVERPASS_TIMEOUT_MS
  )

  if (!response.ok) {
    const error = new Error(`Overpass ${response.status}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }

  const json = await response.json() as OverpassResponse
  const elements = Array.isArray(json.elements) ? json.elements : []
  return elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat
      const lon = el.lon ?? el.center?.lon
      if (typeof lat !== 'number' || typeof lon !== 'number') return null
      return {
        name: el.tags?.name || el.tags?.['name:ru'] || '',
        lat,
        lon,
        tags: el.tags,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

async function fetchCategoryPois(origin: Coords, category: CategoryDef, radiusMeters: number): Promise<Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>> {
  const key = overpassKey(origin, category.key, radiusMeters)
  const now = Date.now()

  const cached = overpassCache.get(key)
  if (cached && cached.expiresAt > now) return cached.results

  const pending = overpassInFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    const cooldownUntil = overpassFailedUntil.get(key)
    if (typeof cooldownUntil === 'number' && cooldownUntil > Date.now()) return []

    const radii = [radiusMeters]
    if (radiusMeters > 1400) radii.push(Math.max(900, Math.round(radiusMeters * 0.65)))

    for (const radius of radii) {
      const query = overpassQuery(category.query, origin, radius)
      const endpoints = endpointOrder(key)
      for (const endpoint of endpoints) {
        try {
          const results = await requestOverpass(endpoint, query)
          const normalized = filterPoisByDistance(origin, results, radius)
          overpassCache.set(key, { results: normalized, expiresAt: Date.now() + OVERPASS_CACHE_TTL_MS })
          overpassFailedUntil.delete(key)
          return normalized
        } catch (error) {
          const status = (error as { status?: number })?.status
          const retryable = typeof status === 'number' ? OVERPASS_RETRYABLE_STATUSES.has(status) : true
          if (!retryable) {
            overpassFailedUntil.set(key, Date.now() + OVERPASS_FAILURE_COOLDOWN_MS)
            return []
          }
          if (status === 429) await sleep(OVERPASS_RETRY_DELAY_MS * 2)
          else await sleep(OVERPASS_RETRY_DELAY_MS)
        }
      }
    }

    overpassFailedUntil.set(key, Date.now() + OVERPASS_FAILURE_COOLDOWN_MS)
    return []
  })().finally(() => {
    overpassInFlight.delete(key)
  })

  overpassInFlight.set(key, request)
  return request
}

async function geocodeDistrict(district: string): Promise<Coords | null> {
  const query = district.trim()
  if (!query) return null

  const cached = geocodeCache.get(query)
  if (cached !== undefined) return cached

  const queryLc = query.toLowerCase()
  const cityLc = MOSCOW_LABEL.toLowerCase()
  const candidates = Array.from(
    new Set(
      [
        query,
        !queryLc.includes(cityLc) ? `${query}, ${MOSCOW_LABEL}` : '',
        !queryLc.includes(cityLc) ? `${MOSCOW_LABEL}, ${query}` : '',
      ]
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )

  try {
    const queue: Array<{ params: URLSearchParams; requireMoscow: boolean }> = []
    for (const candidate of candidates) {
      queue.push({
        params: new URLSearchParams({
          q: candidate,
          format: 'json',
          limit: '1',
          countrycodes: 'ru',
          viewbox: MOSCOW_VIEWBOX,
          bounded: '1',
        }),
        requireMoscow: true,
      })
      queue.push({
        params: new URLSearchParams({
          q: candidate,
          format: 'json',
          limit: '1',
          countrycodes: 'ru',
        }),
        requireMoscow: false,
      })
    }

    for (const attempt of queue) {
      const response = await withTimeout(
        `${NOMINATIM_URL}?${attempt.params}`,
        {
          headers: {
            'Accept-Language': 'ru',
            'User-Agent': USER_AGENT,
          },
        },
        9000
      )
      if (!response.ok) continue

      const json = await response.json() as Array<{ lat: string; lon: string }>
      if (!json.length) continue

      const point = { lat: Number(json[0].lat), lon: Number(json[0].lon) }
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue
      if (attempt.requireMoscow && !isWithinMoscowBounds(point)) continue

      geocodeCache.set(query, point)
      return point
    }

    geocodeCache.set(query, null)
    return null
  } catch {
    geocodeCache.set(query, null)
    return null
  }
}

function normalizeCoords(value?: Coords): Coords | null {
  if (!value) return null
  if (!Number.isFinite(value.lat) || !Number.isFinite(value.lon)) return null
  if (Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180) return null
  return { lat: value.lat, lon: value.lon }
}

async function resolveComplexCoords(complex: Complex): Promise<Coords | null> {
  if (typeof complex.geo_lat === 'number' && typeof complex.geo_lon === 'number') {
    const direct = normalizeCoords({ lat: complex.geo_lat, lon: complex.geo_lon })
    if (direct) return direct
  }
  return geocodeDistrict(complex.district || '')
}

async function osrmTable(profile: 'walking' | 'driving', origin: Coords, destinations: Coords[]): Promise<Array<number | null>> {
  if (!destinations.length) return []
  const coordinates = [
    `${origin.lon},${origin.lat}`,
    ...destinations.map((item) => `${item.lon},${item.lat}`),
  ].join(';')
  const params = new URLSearchParams({
    sources: '0',
    annotations: 'duration',
  })
  const response = await withTimeout(
    `${OSRM_BASE_URL}/table/v1/${profile}/${coordinates}?${params}`,
    {},
    10000
  )
  if (!response.ok) throw new Error(`OSRM ${profile} ${response.status}`)
  const json = await response.json() as { code?: string; durations?: Array<Array<number | null>> }
  if (json.code !== 'Ok' || !Array.isArray(json.durations?.[0])) throw new Error(`OSRM ${profile} invalid`)
  return json.durations[0].slice(1).map((seconds) => (typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null))
}

async function osrmTableBatched(profile: 'walking' | 'driving', origin: Coords, destinations: Coords[]): Promise<Array<number | null>> {
  if (!destinations.length) return []
  const output: Array<number | null> = []
  const batchSize = 18
  for (let i = 0; i < destinations.length; i += batchSize) {
    const batch = destinations.slice(i, i + batchSize)
    const batchMinutes = await osrmTable(profile, origin, batch)
    output.push(...batchMinutes)
  }
  return output
}

function fallbackWalkMinutes(distance: number): number {
  const routed = distance * 1.35
  return Math.max(2, Math.round((routed * 1000) / FALLBACK_WALK_M_PER_MIN))
}

function fallbackDriveMinutes(distance: number): number {
  const routed = distance * 1.5
  return Math.max(3, Math.round((routed * 1000) / FALLBACK_DRIVE_M_PER_MIN))
}

async function getCommonsThumbByFileTitle(fileTitle: string): Promise<string | null> {
  const normalized = fileTitle.trim()
  if (!normalized || /^Category:/i.test(normalized)) return null
  const title = normalized.startsWith('File:') ? normalized : `File:${normalized}`
  const key = title.toLowerCase()
  const cached = commonsFileThumbCache.get(key)
  if (cached !== undefined) return cached

  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '1400',
      titles: title,
    })
    const response = await withTimeout(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 9000)
    if (!response.ok) throw new Error(`commons ${response.status}`)
    const json = await response.json() as { query?: { pages?: Record<string, { imageinfo?: Array<{ thumburl?: string; url?: string }> }> } }
    const pages = json.query?.pages || {}
    const first = Object.values(pages)[0]
    const url = first?.imageinfo?.[0]?.thumburl || first?.imageinfo?.[0]?.url || null
    commonsFileThumbCache.set(key, url)
    return url
  } catch {
    commonsFileThumbCache.set(key, null)
    return null
  }
}

async function getCommonsFileFromWikidata(wikidataId: string): Promise<string | null> {
  const id = wikidataId.trim()
  if (!id) return null
  const cached = wikidataImageFileCache.get(id)
  if (cached !== undefined) return cached

  try {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: id,
      props: 'claims',
    })
    const response = await withTimeout(`https://www.wikidata.org/w/api.php?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 9000)
    if (!response.ok) throw new Error(`wikidata ${response.status}`)
    const json = await response.json() as {
      entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>> }>
    }
    const value = json.entities?.[id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    const fileTitle = typeof value === 'string' && value.trim() ? `File:${value}` : null
    wikidataImageFileCache.set(id, fileTitle)
    return fileTitle
  } catch {
    wikidataImageFileCache.set(id, null)
    return null
  }
}

async function getWikipediaThumb(wikipediaTag: string): Promise<string | null> {
  const key = wikipediaTag.trim()
  if (!key) return null

  const cached = wikipediaThumbCache.get(key)
  if (cached !== undefined) return cached

  const separator = key.indexOf(':')
  const lang = separator > 0 ? key.slice(0, separator) : 'ru'
  const page = separator > 0 ? key.slice(separator + 1) : key
  const title = page.trim().replace(/\s+/g, '_')
  if (!title) {
    wikipediaThumbCache.set(key, null)
    return null
  }

  try {
    const response = await withTimeout(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { 'User-Agent': USER_AGENT } },
      9000
    )
    if (!response.ok) throw new Error(`wikipedia ${response.status}`)
    const json = await response.json() as { thumbnail?: { source?: string } }
    const url = json.thumbnail?.source || null
    wikipediaThumbCache.set(key, url)
    return url
  } catch {
    wikipediaThumbCache.set(key, null)
    return null
  }
}

async function searchCommonsImages(query: string, limit = 8): Promise<string[]> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const cached = commonsSearchCache.get(normalized)
  if (cached) return cached.slice(0, limit)

  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '1600',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: String(Math.max(1, Math.min(limit * 2, 30))),
    })
    const response = await withTimeout(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 9000)
    if (!response.ok) throw new Error(`commons-search ${response.status}`)
    const json = await response.json() as {
      query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string }> }> }
    }
    const pages = json.query?.pages || {}
    const candidates = Object.values(pages).map((page) => ({
      title: page.title || '',
      url: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url,
      score: 1.2,
    }))
    const minHits = minTokenHitsForHint(query)
    let ranked = rankImageCandidatesWithOptions(
      candidates,
      query,
      limit,
      minHits > 0 ? { requireTokenHit: true, minTokenHits: minHits } : undefined
    )
    if (!ranked.length && minHits > 0) {
      ranked = rankImageCandidates(candidates, query, limit)
    }
    commonsSearchCache.set(normalized, ranked)
    return ranked.slice(0, limit)
  } catch {
    commonsSearchCache.set(normalized, [])
    return []
  }
}

const PHOTO_SEARCH_STOPWORDS = new Set([
  'moscow',
  'москва',
  'russia',
  'россия',
  'район',
  'district',
  'metro',
  'station',
  'city',
  'church',
  'церковь',
  'храм',
  'икона',
  'иконы',
  'божией',
  'божьей',
  'матери',
  'центр',
  'center',
  'социальной',
  'адаптации',
  'при',
  'saint',
  'st',
  'sv',
  'sviatogo',
  'named',
  'name',
  'ulitsa',
  'street',
  'prospekt',
  'avenue',
  'road',
  'the',
  'and',
  'for',
  'with',
  'from',
  'near',
  'inside',
  'outside',
  'main',
  'central',
])

const IMAGE_URL_BLOCKLIST_RX = /(logo|icon|pictogram|coat[_\s-]?of[_\s-]?arms|locator[_\s-]?map|openstreetmap|mapnik|wikidata[-_]?logo)/i

type ImageCandidate = {
  url?: string | null
  title?: string
  score?: number
}

const RU_TO_LAT_CHAR_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function transliterateRuToLat(value: string): string {
  if (!value) return ''
  let out = ''
  for (const ch of value) out += RU_TO_LAT_CHAR_MAP[ch] ?? ch
  return out
}

function normalizeCommonsCategoryTitle(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^category:/i.test(trimmed)) {
    return `Category:${trimmed.slice('category:'.length).trim()}`
  }
  return null
}

function tokenizePhotoSearch(value: string): string[] {
  if (!value.trim()) return []
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !PHOTO_SEARCH_STOPWORDS.has(item))
    )
  )
}

function buildNameSearchVariants(name: string): string[] {
  const base = name.trim()
  if (!base) return []

  const withoutBrackets = base.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  const withoutTail = withoutBrackets
    .replace(/\b(при|у|рядом с|возле|около|near|at)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const beforeComma = withoutTail.split(',')[0]?.trim() || ''
  const tokenCompact = tokenizePhotoSearch(base).slice(0, 6).join(' ').trim()

  return Array.from(
    new Set([base, withoutBrackets, withoutTail, beforeComma, tokenCompact].map((item) => item.trim()).filter((item) => item.length >= 3))
  ).slice(0, 4)
}

function countTitleTokenHits(title: string, tokens: string[]): { hits: number; strongHits: number } {
  if (!tokens.length) return { hits: 0, strongHits: 0 }
  const normalizedTitle = normalizeName(title).replace(/[_-]+/g, ' ')
  if (!normalizedTitle) return { hits: 0, strongHits: 0 }
  const normalizedTitleLat = transliterateRuToLat(normalizedTitle)

  let hits = 0
  let strongHits = 0
  for (const token of tokens) {
    const tokenLat = transliterateRuToLat(token)
    const matched = normalizedTitle.includes(token)
      || (tokenLat.length >= 3 && normalizedTitleLat.includes(tokenLat))
    if (!matched) continue
    hits += 1
    if (token.length >= 6) strongHits += 1
  }
  return { hits, strongHits }
}

function scoreTitleByTokens(title: string, tokens: string[]): number {
  const { hits, strongHits } = countTitleTokenHits(title, tokens)
  if (!hits) return 0
  let score = strongHits * 2.2 + (hits - strongHits) * 1.2
  if (hits >= Math.max(1, Math.floor(tokens.length * 0.6))) score += 2
  return score
}

function scoreImageCandidate(candidate: ImageCandidate, tokens: string[]): number {
  const base = Number.isFinite(candidate.score) ? Number(candidate.score) : 0
  const titleScore = scoreTitleByTokens(candidate.title || '', tokens)
  return base + titleScore
}

function isGoodImageUrl(raw: string): boolean {
  const value = raw.trim()
  if (!value || !/^https?:\/\//i.test(value)) return false
  if (IMAGE_URL_BLOCKLIST_RX.test(value)) return false
  if (/\/thumb\/.+\.svg\/\d+px-/i.test(value)) return false
  if (/\.svg(?:\?|$)/i.test(value)) return false
  return true
}

function rankImageCandidates(candidates: ImageCandidate[], hint: string, limit: number): string[] {
  const tokens = tokenizePhotoSearch(hint)
  const byUrl = new Map<string, { score: number; order: number; url: string }>()

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const rawUrl = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!isGoodImageUrl(rawUrl)) continue
    const score = scoreImageCandidate(candidate, tokens)
    const prev = byUrl.get(rawUrl)
    if (!prev || score > prev.score || (score === prev.score && index < prev.order)) {
      byUrl.set(rawUrl, { score, order: index, url: rawUrl })
    }
  }

  return Array.from(byUrl.values())
    .sort((a, b) => (b.score - a.score) || (a.order - b.order))
    .map((entry) => entry.url)
    .slice(0, limit)
}

type RankImageOptions = {
  requireTokenHit?: boolean
  minTokenHits?: number
}

function minTokenHitsForHint(hint: string): number {
  const tokenCount = tokenizePhotoSearch(hint).length
  if (tokenCount >= 8) return 3
  if (tokenCount >= 5) return 2
  if (tokenCount >= 2) return 1
  return 0
}

function rankImageCandidatesWithOptions(
  candidates: ImageCandidate[],
  hint: string,
  limit: number,
  options?: RankImageOptions
): string[] {
  const tokens = tokenizePhotoSearch(hint)
  if (!options?.requireTokenHit || !tokens.length) {
    return rankImageCandidates(candidates, hint, limit)
  }

  const minHits = Math.max(1, options?.minTokenHits || 1)
  const filtered = candidates.filter((candidate) => {
    const title = candidate.title || ''
    const { hits } = countTitleTokenHits(title, tokens)
    return hits >= minHits
  })

  if (!filtered.length) return []
  return rankImageCandidates(filtered, hint, limit)
}

async function getCommonsCategoryFromWikidata(wikidataId: string): Promise<string | null> {
  const id = wikidataId.trim()
  if (!id) return null
  const cached = wikidataCommonsCategoryCache.get(id)
  if (cached !== undefined) return cached

  try {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: id,
      props: 'claims',
    })
    const response = await withTimeout(`https://www.wikidata.org/w/api.php?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 9000)
    if (!response.ok) throw new Error(`wikidata-category ${response.status}`)
    const json = await response.json() as {
      entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>> }>
    }
    const value = json.entities?.[id]?.claims?.P373?.[0]?.mainsnak?.datavalue?.value
    const categoryTitle = typeof value === 'string' && value.trim()
      ? (value.startsWith('Category:') ? value : `Category:${value}`)
      : null
    wikidataCommonsCategoryCache.set(id, categoryTitle)
    return categoryTitle
  } catch {
    wikidataCommonsCategoryCache.set(id, null)
    return null
  }
}

async function searchCommonsImagesByGeo(point: Coords, nameHint: string, limit = 10, radiusMeters = IMAGE_GEOSEARCH_RADIUS_METERS): Promise<string[]> {
  const key = `${point.lat.toFixed(4)}:${point.lon.toFixed(4)}:${Math.round(radiusMeters)}:${limit}:${normalizeName(nameHint).slice(0, 80)}`
  const cached = commonsGeoSearchCache.get(key)
  if (cached) return cached.slice(0, limit)

  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '1600',
      generator: 'geosearch',
      ggsnamespace: '6',
      ggscoord: `${point.lat}|${point.lon}`,
      ggsradius: String(Math.max(60, Math.min(Math.round(radiusMeters), 10000))),
      ggslimit: String(Math.max(1, Math.min(limit * 2, 50))),
    })
    const response = await withTimeout(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 9000)
    if (!response.ok) throw new Error(`commons-geo ${response.status}`)

    const json = await response.json() as {
      query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string }> }> }
    }
    const pages = json.query?.pages || {}
    const candidates = Object.values(pages).map((page) => ({
      title: page.title || '',
      url: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url,
      score: 2.2,
    }))
    const ranked = rankImageCandidatesWithOptions(candidates, nameHint, limit, {
      requireTokenHit: true,
      minTokenHits: Math.max(1, minTokenHitsForHint(nameHint)),
    })
    commonsGeoSearchCache.set(key, ranked)
    return ranked.slice(0, limit)
  } catch {
    commonsGeoSearchCache.set(key, [])
    return []
  }
}

async function searchCommonsImagesByCategory(categoryTitle: string, nameHint: string, limit = 12): Promise<string[]> {
  const normalizedCategory = normalizeCommonsCategoryTitle(categoryTitle)
  if (!normalizedCategory) return []
  const key = `${normalizedCategory.toLowerCase()}:${limit}:${normalizeName(nameHint).slice(0, 80)}`
  const cached = commonsCategorySearchCache.get(key)
  if (cached) return cached.slice(0, limit)

  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: '1600',
      generator: 'categorymembers',
      gcmtitle: normalizedCategory,
      gcmnamespace: '6',
      gcmlimit: String(Math.max(1, Math.min(limit * 2, 40))),
    })
    const response = await withTimeout(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 9000)
    if (!response.ok) throw new Error(`commons-category ${response.status}`)
    const json = await response.json() as {
      query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string }> }> }
    }
    const pages = json.query?.pages || {}
    const candidates = Object.values(pages).map((page) => ({
      title: page.title || '',
      url: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url,
      score: 2.6,
    }))
    const ranked = rankImageCandidatesWithOptions(candidates, nameHint, limit, {
      requireTokenHit: true,
      minTokenHits: Math.max(1, minTokenHitsForHint(nameHint)),
    })
    commonsCategorySearchCache.set(key, ranked)
    return ranked.slice(0, limit)
  } catch {
    commonsCategorySearchCache.set(key, [])
    return []
  }
}

function buildPhotoSearchQueries(name: string, district?: string, category?: string): string[] {
  const districtPart = (district || '').trim()
  const categoryPart = (category || '').trim()
  const nameVariants = buildNameSearchVariants(name)
  if (!nameVariants.length) return []

  const out: string[] = []
  for (const base of nameVariants) {
    out.push(
      districtPart ? `${base} ${districtPart} ${MOSCOW_LABEL}` : '',
      `${base} ${MOSCOW_LABEL}`,
      categoryPart ? `${base} ${categoryPart} ${MOSCOW_LABEL}` : '',
      categoryPart ? `${base} ${categoryPart}` : '',
      base,
    )
  }

  return Array.from(new Set(out.map((item) => item.trim()).filter(Boolean))).slice(0, 10)
}

async function searchWikipediaImages(query: string, limit = 8): Promise<string[]> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []

  const cached = wikipediaSearchCache.get(normalized)
  if (cached) return cached.slice(0, limit)

  const result: string[] = []
  for (const lang of ['ru', 'en']) {
    if (result.length >= limit) break
    try {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'pageimages',
        pithumbsize: '1400',
        generator: 'search',
        gsrsearch: query,
        gsrlimit: String(Math.max(1, Math.min(limit * 2, 24))),
      })
      const response = await withTimeout(
        `https://${lang}.wikipedia.org/w/api.php?${params}`,
        { headers: { 'User-Agent': USER_AGENT } },
        9000
      )
      if (!response.ok) continue

      const json = await response.json() as { query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> } }
      const pages = json.query?.pages || {}
      const candidates = Object.values(pages).map((page) => ({
        title: page.title || '',
        url: page.thumbnail?.source,
        score: lang === 'ru' ? 1.6 : 1.0,
      }))
      const minHits = minTokenHitsForHint(query)
      let ranked = rankImageCandidatesWithOptions(
        candidates,
        query,
        limit,
        minHits > 0 ? { requireTokenHit: true, minTokenHits: minHits } : undefined
      )
      if (!ranked.length && minHits > 0) {
        ranked = rankImageCandidates(candidates, query, limit)
      }
      pushUniqueUrls(result, ranked, limit)
    } catch {
      // Ignore per-source failure and continue with the rest.
    }
  }

  wikipediaSearchCache.set(normalized, result.slice(0, limit))
  return result.slice(0, limit)
}

async function searchWikipediaImagesByGeo(point: Coords, nameHint: string, limit = 10, radiusMeters = IMAGE_GEOSEARCH_RADIUS_METERS): Promise<string[]> {
  const key = `${point.lat.toFixed(4)}:${point.lon.toFixed(4)}:${Math.round(radiusMeters)}:${limit}:${normalizeName(nameHint).slice(0, 80)}`
  const cached = wikipediaGeoSearchCache.get(key)
  if (cached) return cached.slice(0, limit)

  const result: string[] = []
  for (const lang of ['ru', 'en']) {
    if (result.length >= limit) break
    try {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'pageimages',
        pithumbsize: '1400',
        generator: 'geosearch',
        ggscoord: `${point.lat}|${point.lon}`,
        ggsradius: String(Math.max(60, Math.min(Math.round(radiusMeters), 10000))),
        ggslimit: String(Math.max(1, Math.min(limit * 2, 50))),
      })
      const response = await withTimeout(
        `https://${lang}.wikipedia.org/w/api.php?${params}`,
        { headers: { 'User-Agent': USER_AGENT } },
        9000
      )
      if (!response.ok) continue

      const json = await response.json() as { query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> } }
      const pages = json.query?.pages || {}
      const candidates = Object.values(pages).map((page) => ({
        title: page.title || '',
        url: page.thumbnail?.source,
        score: lang === 'ru' ? 2.3 : 1.9,
      }))
      const ranked = rankImageCandidatesWithOptions(candidates, nameHint, limit, {
        requireTokenHit: true,
        minTokenHits: Math.max(1, minTokenHitsForHint(nameHint)),
      })
      pushUniqueUrls(result, ranked, limit)
    } catch {
      // Ignore per-source failure and continue with the rest.
    }
  }

  wikipediaGeoSearchCache.set(key, result.slice(0, limit))
  return result.slice(0, limit)
}

async function searchOpenverseImages(query: string, limit = 8): Promise<string[]> {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []

  const cached = openverseSearchCache.get(normalized)
  if (cached) return cached.slice(0, limit)

  try {
    const params = new URLSearchParams({
      q: query,
      page_size: String(Math.max(1, Math.min(limit * 2, 24))),
    })
    const response = await withTimeout(
      `https://api.openverse.org/v1/images/?${params}`,
      { headers: { 'User-Agent': USER_AGENT } },
      9000
    )
    if (!response.ok) throw new Error(`openverse ${response.status}`)

    const json = await response.json() as { results?: Array<{ title?: string; thumbnail?: string; url?: string }> }
    const candidates = (json.results || []).map((item) => ({
      title: item.title || '',
      url: item.thumbnail || item.url,
      score: 0.6,
    }))

    const minHits = minTokenHitsForHint(query)
    let ranked = rankImageCandidatesWithOptions(
      candidates,
      query,
      limit,
      minHits > 0 ? { requireTokenHit: true, minTokenHits: minHits } : undefined
    )
    if (!ranked.length && minHits > 0) {
      ranked = rankImageCandidates(candidates, query, limit)
    }
    openverseSearchCache.set(normalized, ranked)
    return ranked.slice(0, limit)
  } catch {
    openverseSearchCache.set(normalized, [])
    return []
  }
}

async function searchPhotoVariantsByQuery(query: string, limit = 12, includeOpenverse = false): Promise<string[]> {
  const [commons, wikipedia, openverse] = await Promise.all([
    searchCommonsImages(query, Math.min(limit, 12)),
    searchWikipediaImages(query, Math.min(limit, 12)),
    includeOpenverse ? searchOpenverseImages(query, Math.min(limit, 10)) : Promise.resolve([]),
  ])

  const result: string[] = []
  pushUniqueUrls(result, commons, limit)
  pushUniqueUrls(result, wikipedia, limit)
  pushUniqueUrls(result, openverse, limit)
  return result.slice(0, limit)
}

async function searchPhotoVariantsNearPoint(point: Coords, nameHint: string, limit = 12): Promise<string[]> {
  const [commonsNear, commonsWide, wikipediaNear] = await Promise.all([
    searchCommonsImagesByGeo(point, nameHint, Math.min(limit, IMAGE_GEOSEARCH_LIMIT), IMAGE_GEOSEARCH_RADIUS_METERS),
    searchCommonsImagesByGeo(point, nameHint, Math.min(limit, IMAGE_GEOSEARCH_WIDE_LIMIT), IMAGE_GEOSEARCH_WIDE_RADIUS_METERS),
    searchWikipediaImagesByGeo(point, nameHint, Math.min(limit, IMAGE_GEOSEARCH_LIMIT), IMAGE_GEOSEARCH_RADIUS_METERS),
  ])

  const result: string[] = []
  pushUniqueUrls(result, commonsNear, limit)
  pushUniqueUrls(result, wikipediaNear, limit)
  pushUniqueUrls(result, commonsWide, limit)
  return result.slice(0, limit)
}

function pushUniqueUrls(target: string[], source: Array<string | null | undefined>, max = IMAGE_VARIANTS_LIMIT): void {
  const seen = new Set(target.map((item) => item.trim()))
  for (const item of source) {
    if (typeof item !== 'string') continue
    const value = item.trim()
    if (!isGoodImageUrl(value) || seen.has(value)) continue
    seen.add(value)
    target.push(value)
    if (target.length >= max) return
  }
}

function placeId(name: string, lat: number, lon: number): string {
  const slug = slugify(name).replace(/-/g, '_').slice(0, 48) || 'place'
  return `nearby_${slug}_${Math.round(lat * 10000)}_${Math.round(lon * 10000)}`
}

function getCategoryFallbackImages(category?: string): string[] {
  const lookup = (category || '').trim().toLowerCase()
  if (!lookup) return []
  const found = CATEGORIES.find((item) => item.key.toLowerCase() === lookup || item.label.toLowerCase() === lookup)
  return found?.fallbackImages || []
}

async function resolvePlaceImages(poi: PoiWithMeta, district: string): Promise<{ imageUrl: string; variants: string[]; fallback: boolean }> {
  const tags = poi.tags || {}
  const variants: string[] = []

  pushUniqueUrls(variants, [tags.image, tags['image:0']])

  const wikiTag = tags.wikipedia
  if (typeof wikiTag === 'string' && wikiTag.trim()) {
    pushUniqueUrls(variants, [await getWikipediaThumb(wikiTag)])
  }

  const commonsTag = typeof tags.wikimedia_commons === 'string' ? tags.wikimedia_commons.trim() : ''
  if (commonsTag) {
    const commonsCategory = normalizeCommonsCategoryTitle(commonsTag)
    if (commonsCategory) {
      const fromCategory = await searchCommonsImagesByCategory(commonsCategory, poi.name, 10)
      pushUniqueUrls(variants, fromCategory, IMAGE_VARIANTS_LIMIT)
    } else {
      pushUniqueUrls(variants, [await getCommonsThumbByFileTitle(commonsTag)], IMAGE_VARIANTS_LIMIT)
    }
  }

  const wikidataTag = tags.wikidata
  if (typeof wikidataTag === 'string' && wikidataTag.trim()) {
    const [fileTitle, categoryTitle] = await Promise.all([
      getCommonsFileFromWikidata(wikidataTag),
      getCommonsCategoryFromWikidata(wikidataTag),
    ])
    if (fileTitle) pushUniqueUrls(variants, [await getCommonsThumbByFileTitle(fileTitle)], IMAGE_VARIANTS_LIMIT)
    if (categoryTitle && variants.length < 12) {
      const fromCategory = await searchCommonsImagesByCategory(categoryTitle, poi.name, 10)
      pushUniqueUrls(variants, fromCategory, IMAGE_VARIANTS_LIMIT)
    }
  }

  if (variants.length < 10) {
    const nearImages = await searchPhotoVariantsNearPoint({ lat: poi.lat, lon: poi.lon }, poi.name, 14)
    pushUniqueUrls(variants, nearImages, IMAGE_VARIANTS_LIMIT)
  }

  const searchQueries = buildPhotoSearchQueries(poi.name, district, poi.category.label)
  for (let i = 0; i < searchQueries.length && variants.length < IMAGE_VARIANTS_LIMIT; i += 1) {
    const includeOpenverse = variants.length < 8 && i >= 2
    const searched = await searchPhotoVariantsByQuery(searchQueries[i], 12, includeOpenverse)
    pushUniqueUrls(variants, searched, IMAGE_VARIANTS_LIMIT)
  }

  if (variants.length > 0) {
    return { imageUrl: variants[0], variants, fallback: false }
  }

  const fallback = poi.category.fallbackImages
  const fallbackImage = fallback[Math.abs(placeId(poi.name, poi.lat, poi.lon).length) % fallback.length]
  const fallbackVariants = [fallbackImage, ...fallback].filter(Boolean)
  return { imageUrl: fallbackImage, variants: Array.from(new Set(fallbackVariants)), fallback: true }
}

async function collectPoiCandidates(origin: Coords): Promise<PoiWithMeta[]> {
  const categoryResults = await Promise.all(
    CATEGORIES.map(async (category) => {
      const pois = await fetchCategoryPois(origin, category, SEARCH_RADIUS_METERS)
      return pois
        .filter((poi) => {
          if (normalizeName(poi.name).length <= 1) return false
          if (!isGenericPlaceName(poi.name)) return true
          const tags = poi.tags || {}
          return Boolean(
            tags.wikipedia
            || tags.wikidata
            || tags.wikimedia_commons
            || tags.brand
            || tags.operator
            || tags.tourism
            || tags.amenity
            || tags.leisure
          )
        })
        .map((poi) => ({ ...poi, category, distanceKm: distanceKm(origin, { lat: poi.lat, lon: poi.lon }) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, MAX_PER_CATEGORY)
    })
  )

  const merged = categoryResults.flat().sort((a, b) => a.distanceKm - b.distanceKm)
  const deduped: PoiWithMeta[] = []
  const seen = new Set<string>()
  for (const item of merged) {
    const key = normalizeName(item.name) || `${item.lat.toFixed(4)}_${item.lon.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
    if (deduped.length >= MAX_CANDIDATES_BEFORE_ROUTES) break
  }
  return deduped
}

export async function generateNearbyPlacesForComplex(
  complex: Complex,
  originOverride?: Coords
): Promise<{ origin: Coords | null; items: ComplexNearbyPlace[]; reason?: string }> {
  const origin = normalizeCoords(originOverride) || await resolveComplexCoords(complex)
  if (!origin) {
    return { origin: null, items: [], reason: 'Unable to resolve complex coordinates' }
  }

  const candidates = await collectPoiCandidates(origin)
  if (!candidates.length) return { origin, items: [] }

  const destinations = candidates.map((item) => ({ lat: item.lat, lon: item.lon }))
  const [walkResult, driveResult] = await Promise.allSettled([
    osrmTableBatched('walking', origin, destinations),
    osrmTableBatched('driving', origin, destinations),
  ])
  const walk = walkResult.status === 'fulfilled' ? walkResult.value : []
  const drive = driveResult.status === 'fulfilled' ? driveResult.value : []

  const routedCandidates = candidates
    .map((item, index) => {
      const walkMinutes = walk[index] ?? fallbackWalkMinutes(item.distanceKm)
      const driveMinutes = drive[index] ?? fallbackDriveMinutes(item.distanceKm)
      return {
        ...item,
        walkMinutes,
        driveMinutes,
      }
    })
  const withinTravel = routedCandidates.filter((item) => item.walkMinutes <= MAX_MINUTES || item.driveMinutes <= MAX_MINUTES)
  const pool = withinTravel.length >= MIN_ROUTED_CANDIDATES ? withinTravel : routedCandidates
  const picked = pickInterestingCandidates(pool, MAX_ITEMS)

  const items = await mapWithConcurrency(
    picked,
    IMAGE_RESOLVE_CONCURRENCY,
    async (item) => {
      const image = await resolvePlaceImages(item, complex.district || '')
      return {
        id: placeId(item.name, item.lat, item.lon),
        name: item.name || item.category.label,
        category: item.category.label,
        lat: item.lat,
        lon: item.lon,
        walk_minutes: item.walkMinutes,
        drive_minutes: item.driveMinutes,
        image_url: image.imageUrl,
        image_variants: image.variants,
        image_fallback: image.fallback || undefined,
      } satisfies ComplexNearbyPlace
    }
  )

  return { origin, items }
}

export async function searchNearbyPhotoVariants(name: string, district?: string, category?: string, point?: Coords): Promise<string[]> {
  const base = name.trim()
  if (!base) return []

  const result: string[] = []
  const normalizedPoint = normalizeCoords(point)

  if (normalizedPoint) {
    const near = await searchPhotoVariantsNearPoint(normalizedPoint, base, 16)
    pushUniqueUrls(result, near, IMAGE_VARIANTS_LIMIT)
  }

  const queries = buildPhotoSearchQueries(base, district, category)
  for (let i = 0; i < queries.length; i += 1) {
    const includeOpenverse = result.length < 8 && i >= 2
    const urls = await searchPhotoVariantsByQuery(queries[i], 12, includeOpenverse)
    pushUniqueUrls(result, urls, IMAGE_VARIANTS_LIMIT)
    if (result.length >= IMAGE_VARIANTS_LIMIT) break
  }

  if (normalizedPoint && result.length < 10) {
    const wide = await searchCommonsImagesByGeo(normalizedPoint, base, 12, IMAGE_GEOSEARCH_WIDE_RADIUS_METERS)
    pushUniqueUrls(result, wide, IMAGE_VARIANTS_LIMIT)
  }

  if (result.length < 6) {
    const categoryFallback = getCategoryFallbackImages(category)
    pushUniqueUrls(result, categoryFallback, IMAGE_VARIANTS_LIMIT)
  }

  return result.slice(0, IMAGE_VARIANTS_LIMIT)
}



