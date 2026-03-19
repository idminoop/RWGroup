import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { CatalogTab, Category } from '../../shared/types.js'
import { withDbRead, withPublishedDb, readDb } from '../lib/storage.js'
import { resolveCollectionItems } from '../lib/collections.js'

const router = Router()

function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

function dedupe(arr: string[]): string[] {
  const set = new Set(arr.map((s) => s.trim()).filter(Boolean))
  return Array.from(set)
}

const MOSCOW_BOUNDS = {
  minLat: 54.9,
  maxLat: 56.3,
  minLon: 36.2,
  maxLon: 38.8,
}

const MOSCOW_VIEWBOX = `${MOSCOW_BOUNDS.minLon},${MOSCOW_BOUNDS.maxLat},${MOSCOW_BOUNDS.maxLon},${MOSCOW_BOUNDS.minLat}`
const YANDEX_GEOCODER_URL = 'https://geocode-maps.yandex.ru/1.x/'
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_TIMEOUT_MS = 4200
const NOMINATIM_RETRY_ATTEMPTS = 0
const NOMINATIM_RETRY_DELAY_MS = 300
const NOMINATIM_MIN_INTERVAL_MS = 1100
const GEOCODE_ROUTE_MAX_MS = 12000
const STRONG_GEOCODE_SCORE = 175
const GEOCODE_CACHE_TTL_MS = 15 * 60 * 1000
const GEOCODE_NEGATIVE_CACHE_TTL_MS = 45 * 1000
const KREMLIN_COORDS = { lat: 55.752023, lon: 37.617499 }
const MAX_MOSCOW_DISTANCE_KM = 45

const GEOCODE_STOPWORDS = new Set([
  'москва',
  'moscow',
  'жк',
  'жилой',
  'комплекс',
  'ул',
  'улица',
  'проспект',
  'пр',
  'дом',
])

const EXTRA_GEOCODE_STOPWORDS = new Set([
  '\u043c\u043e\u0441\u043a\u0432\u0430',
  '\u0436\u043a',
  '\u0436\u0438\u043b\u043e\u0439',
  '\u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441',
  '\u0443\u043b',
  '\u0443\u043b\u0438\u0446\u0430',
  '\u043f\u0440',
  '\u043f\u0440\u043e\u0441\u043f\u0435\u043a\u0442',
  '\u0434\u043e\u043c',
])

function isWithinMoscowBounds(lat: number, lon: number): boolean {
  return lat >= MOSCOW_BOUNDS.minLat
    && lat <= MOSCOW_BOUNDS.maxLat
    && lon >= MOSCOW_BOUNDS.minLon
    && lon <= MOSCOW_BOUNDS.maxLon
}

type NominatimCandidate = {
  lat: string
  lon: string
  display_name?: string
  class?: string
  type?: string
  importance?: number
  address?: Record<string, string>
}

type NominatimFetchResult = {
  candidates: NominatimCandidate[]
  transientError: boolean
}

type RankedCandidate = {
  lat: number
  lon: number
  score: number
  displayName?: string
}

type YandexGeocodeAttemptDebug = {
  query: string
  durationMs: number
  status: 'ok' | 'http_error' | 'empty' | 'out_of_bounds' | 'aborted' | 'error'
  httpStatus?: number
  error?: string
}

type CachedGeocodeResult = {
  lat: number
  lon: number
  score?: number
  display_name?: string
} | null

type GeocodeCacheEntry = {
  data: CachedGeocodeResult
  expiresAt: number
}

const geocodeResultCache = new Map<string, GeocodeCacheEntry>()
let nominatimLastCallAt = 0
let nominatimQueue: Promise<void> = Promise.resolve()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  for (const raw of values) {
    const value = raw.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }

  return output
}

function hasAddressHint(value: string): boolean {
  if (!value.trim()) return false
  const hasHouseNumber = /\b\d+[\p{L}]?\b/u.test(value)
  const hasStreetKeyword = /\b(?:\u0443\u043b(?:\.|\u0438\u0446\u0430)?|\u043f\u0440(?:-|\.)?|\u043f\u0440\u043e\u0441\u043f(?:\.|\u0435\u043a\u0442)?|\u043f\u0435\u0440(?:\.|\u0435\u0443\u043b\u043e\u043a)?|\u043d\u0430\u0431(?:\.|\u0435\u0440\u0435\u0436\u043d\u0430\u044f)?|\u0448\u043e\u0441\u0441\u0435|\u0431\u0443\u043b(?:\.|\u044c\u0432\u0430\u0440)?|\u043f\u043b(?:\.|\u043e\u0449\u0430\u0434\u044c)?|\u0430\u043b\u043b\u0435\u044f|\u0432\u0430\u043b|\u043c\u043a\u0440(?:\.|\u0430\u0439\u043e\u043d)?|street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?)\b/iu.test(value)
  return hasHouseNumber || hasStreetKeyword
}

function isNumericLikeToken(value: string): boolean {
  return /^\d+[\p{L}]?$/iu.test(value)
}

function normalizeHouseToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function extractHouseTokens(value: string): string[] {
  const rawMatches = value.match(/\d+\s*[/\\-]\s*\d+[\p{L}]?|\d+[\p{L}]?/giu) || []
  return uniqStrings(rawMatches.map((token) => normalizeHouseToken(token)).filter(Boolean))
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earthRadius = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function buildGeocodeQueryVariants(query: string, city: string): string[] {
  const compactQuery = query.replace(/\s+/g, ' ').trim()
  const cityValue = city.trim()
  const cityLc = cityValue.toLowerCase()

  const withoutComplexPrefix = compactQuery
    .replace(/^\s*(?:\u0436\u043a|\u0436\u0438\u043b\u043e\u0439\s+\u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441)\s+/iu, '')
    .trim()

  const withoutComplexWord = withoutComplexPrefix
    .replace(/\b\u0436\u043a\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const parts = withoutComplexWord.split(',').map((item) => item.trim()).filter(Boolean)
  const reordered = parts.length > 1
    ? `${parts.slice(1).join(', ')}, ${parts[0]}`
    : ''
  const addressOnly = parts.length > 1 && !hasAddressHint(parts[0])
    ? parts.slice(1).join(', ')
    : ''

  const withCity = cityValue && !compactQuery.toLowerCase().includes(cityLc)
    ? `${compactQuery}, ${cityValue}`
    : ''

  const withCityNoComplex = cityValue && withoutComplexWord && !withoutComplexWord.toLowerCase().includes(cityLc)
    ? `${withoutComplexWord}, ${cityValue}`
    : ''

  return uniqStrings([
    compactQuery,
    withoutComplexPrefix,
    withoutComplexWord,
    addressOnly,
    reordered,
    withCity,
    withCityNoComplex,
  ])
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !GEOCODE_STOPWORDS.has(item) && !EXTRA_GEOCODE_STOPWORDS.has(item))
}

function roadLikePenalty(className?: string, type?: string): number {
  const cls = (className || '').toLowerCase()
  const tp = (type || '').toLowerCase()
  if (cls === 'highway') return -120
  if (/(motorway|trunk|primary|secondary|tertiary|road|service|track|path|footway)/i.test(tp)) return -90
  return 0
}

function localityPenalty(displayName?: string): number {
  const text = (displayName || '').toLowerCase()
  if (!text) return 0
  if (/\b(?:\u0434\u0435\u0440\u0435\u0432\u043d|\u0441\u0435\u043b\u043e|\u043f\u043e\u0441[\u0435\u0451]\u043b\u043e\u043a|village|hamlet)\b/i.test(text)) return -70
  return 0
}

function buildCandidateScore(candidate: NominatimCandidate, query: string, moscowFirst: boolean): RankedCandidate | null {
  const lat = Number.parseFloat(candidate.lat)
  const lon = Number.parseFloat(candidate.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  if (moscowFirst && !isWithinMoscowBounds(lat, lon)) return null
  if (moscowFirst) {
    const distToKremlin = haversineKm(lat, lon, KREMLIN_COORDS.lat, KREMLIN_COORDS.lon)
    if (distToKremlin > MAX_MOSCOW_DISTANCE_KM) return null
  }

  const displayName = candidate.display_name || ''
  const candidateText = [
    displayName,
    candidate.address?.road,
    candidate.address?.house_number,
    candidate.address?.city,
    candidate.address?.state,
    candidate.address?.suburb,
  ]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join(' ')
    .toLowerCase()

  const queryTokens = tokenize(query)
  const textualTokens = queryTokens.filter((token) => !isNumericLikeToken(token))
  const numericTokens = queryTokens.filter((token) => isNumericLikeToken(token))
  const textualHits = textualTokens.reduce((acc, token) => (candidateText.includes(token) ? acc + 1 : acc), 0)
  const numericHits = numericTokens.reduce((acc, token) => (candidateText.includes(token) ? acc + 1 : acc), 0)
  const tokenHits = textualHits + numericHits
  const explicitAddressQuery = hasAddressHint(query)
  if (explicitAddressQuery && textualTokens.length > 0 && textualHits === 0) return null

  const queryHouseTokens = extractHouseTokens(query)
  const hasHouseInQuery = queryHouseTokens.length > 0
  const candidateHouse = candidate.address?.house_number || ''
  const normalizedCandidateHouse = normalizeHouseToken(candidateHouse)
  const houseMatched = hasHouseInQuery && normalizedCandidateHouse
    ? queryHouseTokens.some((token) => normalizedCandidateHouse.includes(token) || token.includes(normalizedCandidateHouse))
    : false
  if (explicitAddressQuery && hasHouseInQuery && !houseMatched && textualHits === 0) return null

  let score = 0
  score += textualHits * 30
  score += numericHits * 8
  score += Math.round((candidate.importance || 0) * 100)
  score += isWithinMoscowBounds(lat, lon) ? 30 : -200
  score += roadLikePenalty(candidate.class, candidate.type)
  score += localityPenalty(displayName)

  if (candidate.class === 'building') score += 40
  if (candidate.type === 'house') score += 40
  if (candidate.class === 'place') score -= 35
  if (candidate.type === 'neighbourhood') score -= 12

  if (hasHouseInQuery) score += houseMatched ? 35 : -40
  if (tokenHits === 0) score -= 40
  if (tokenHits >= Math.max(2, Math.floor(queryTokens.length / 2))) score += 25

  return { lat, lon, score, displayName }
}

async function waitForNominatimSlot(deadlineAt: number): Promise<boolean> {
  let release: (() => void) | null = null
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const previous = nominatimQueue
  nominatimQueue = previous.then(() => gate).catch(() => gate)

  await previous
  const now = Date.now()
  const waitMs = Math.max(0, nominatimLastCallAt + NOMINATIM_MIN_INTERVAL_MS - now)
  if (Date.now() + waitMs >= deadlineAt) {
    release?.()
    return false
  }

  if (waitMs > 0) await sleep(waitMs)
  nominatimLastCallAt = Date.now()
  release?.()
  return true
}

async function fetchYandexGeocode(
  query: string,
  apiKey: string,
  options?: { timeoutMs?: number; moscowOnly?: boolean }
): Promise<{ point: { lat: number; lon: number } | null; debug: YandexGeocodeAttemptDebug }> {
  const startedAt = Date.now()
  const timeoutMs = Math.max(1200, Math.min(6000, Math.floor(options?.timeoutMs ?? 3200)))
  const moscowOnly = options?.moscowOnly !== false
  const params = new URLSearchParams({
    apikey: apiKey,
    geocode: query,
    format: 'json',
    results: '4',
    lang: 'ru_RU',
  })
  if (moscowOnly) {
    params.set('bbox', `${MOSCOW_BOUNDS.minLon},${MOSCOW_BOUNDS.minLat}~${MOSCOW_BOUNDS.maxLon},${MOSCOW_BOUNDS.maxLat}`)
    params.set('rspn', '1')
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`${YANDEX_GEOCODER_URL}?${params}`, {
      headers: { 'User-Agent': 'RWGroupWebsite/1.0' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    if (!response.ok) {
      return {
        point: null,
        debug: {
          query,
          durationMs: Date.now() - startedAt,
          status: 'http_error',
          httpStatus: response.status,
        },
      }
    }

    const json = await response.json() as {
      response?: {
        GeoObjectCollection?: {
          featureMember?: Array<{ GeoObject?: { Point?: { pos?: string } } }>
        }
      }
    }
    const featureMember = json?.response?.GeoObjectCollection?.featureMember || []
    if (!featureMember.length) {
      return {
        point: null,
        debug: {
          query,
          durationMs: Date.now() - startedAt,
          status: 'empty',
        },
      }
    }

    let firstFinitePoint: { lat: number; lon: number } | null = null
    for (const item of featureMember) {
      const pos = item?.GeoObject?.Point?.pos
      if (!pos) continue
      const [lonStr, latStr] = pos.trim().split(' ')
      const lon = parseFloat(lonStr)
      const lat = parseFloat(latStr)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      if (!firstFinitePoint) firstFinitePoint = { lat, lon }
      if (!moscowOnly || isWithinMoscowBounds(lat, lon)) {
        return {
          point: { lat, lon },
          debug: {
            query,
            durationMs: Date.now() - startedAt,
            status: 'ok',
          },
        }
      }
    }

    return {
      point: null,
      debug: {
        query,
        durationMs: Date.now() - startedAt,
        status: firstFinitePoint ? 'out_of_bounds' : 'empty',
      },
    }
  } catch (error) {
    return {
      point: null,
      debug: {
        query,
        durationMs: Date.now() - startedAt,
        status: error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'error',
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

async function fetchNominatimCandidates(params: URLSearchParams, deadlineAt: number): Promise<NominatimFetchResult> {
  let transientError = false

  for (let attempt = 0; attempt <= NOMINATIM_RETRY_ATTEMPTS; attempt += 1) {
    const slotGranted = await waitForNominatimSlot(deadlineAt)
    if (!slotGranted) return { candidates: [], transientError: true }

    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) {
      return { candidates: [], transientError: true }
    }

    const timeoutMs = Math.max(600, Math.min(NOMINATIM_TIMEOUT_MS, remaining))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, {
        headers: {
          'Accept-Language': 'ru',
          'User-Agent': 'RWGroupWebsite/1.0',
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        if (response.status === 429) {
          transientError = true
          return { candidates: [], transientError }
        }
        if (retryable) {
          transientError = true
          if (attempt < NOMINATIM_RETRY_ATTEMPTS) {
            const retryDelay = NOMINATIM_RETRY_DELAY_MS * (attempt + 1)
            if (Date.now() + retryDelay >= deadlineAt) {
              return { candidates: [], transientError }
            }
            await sleep(retryDelay)
            continue
          }
        }

        return { candidates: [], transientError }
      }

      const json = await response.json() as NominatimCandidate[]
      return { candidates: Array.isArray(json) ? json : [], transientError }
    } catch {
      transientError = true
      if (attempt < NOMINATIM_RETRY_ATTEMPTS) {
        const retryDelay = NOMINATIM_RETRY_DELAY_MS * (attempt + 1)
        if (Date.now() + retryDelay >= deadlineAt) {
          return { candidates: [], transientError }
        }
        await sleep(retryDelay)
        continue
      }
      return { candidates: [], transientError }
    } finally {
      clearTimeout(timer)
    }
  }

  return { candidates: [], transientError }
}

function tabToCategory(tab: CatalogTab): Category {
  if (tab === 'secondary') return 'secondary'
  if (tab === 'rent') return 'rent'
  return 'newbuild'
}

router.get('/home', (req: Request, res: Response) => {
  const data = withPublishedDb((db) => {
    const featuredComplexes = db.home.featured.complexes
      .map((id) => db.complexes.find((c) => c.id === id && c.status === 'active'))
      .filter(Boolean)
    const featuredProperties = db.home.featured.properties
      .map((id) => db.properties.find((p) => p.id === id && p.status === 'active'))
      .filter(Boolean)

    // Show ALL visible collections, sorted by priority (descending)
    const featuredCollections = db.collections
      .filter((c) => c.status === 'visible')
      .sort((a, b) => b.priority - a.priority)

    return {
      home: db.home,
      featured: {
        complexes: featuredComplexes,
        properties: featuredProperties,
        collections: featuredCollections,
      },
    }
  })
  res.json({ success: true, data })
})

router.get('/map-config', (req: Request, res: Response) => {
  const data = withDbRead((db) => ({
    yandex_maps_api_key: (db.home?.maps?.yandex_maps_api_key || '').trim(),
  }))
  res.json({ success: true, data })
})

router.get('/facets', (req: Request, res: Response) => {
  const data = withPublishedDb((db) => {
    const districts = dedupe([...db.complexes, ...db.properties].map((x) => x.district)).sort((a, b) => a.localeCompare(b))
    const metros = dedupe([...db.complexes, ...db.properties].flatMap((x) => x.metro)).sort((a, b) => a.localeCompare(b))
    return { districts, metros }
  })
  res.json({ success: true, data })
})

router.get('/catalog', (req: Request, res: Response) => {
  const schema = z.object({
    tab: z.enum(['newbuild', 'secondary', 'rent']).default('newbuild'),
    complexId: z.string().optional(),
    bedrooms: z.string().optional(),
    priceMin: z.string().optional(),
    priceMax: z.string().optional(),
    areaMin: z.string().optional(),
    areaMax: z.string().optional(),
    district: z.string().optional(),
    metro: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
    q: z.string().optional(),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid query' })
    return
  }
  const { tab, complexId, bedrooms, priceMin, priceMax, areaMin, areaMax, district, metro, q, page, limit } = parsed.data
  const cat = tabToCategory(tab)
  const bed = toNumber(bedrooms)
  const min = toNumber(priceMin)
  const max = toNumber(priceMax)
  const amin = toNumber(areaMin)
  const amax = toNumber(areaMax)
  const districtLc = (district || '').trim().toLowerCase()
  const metroLc = (metro || '').trim().toLowerCase()
  const qlc = (q || '').trim().toLowerCase()
  const pageNum = Math.max(toNumber(page) || 1, 1)
  const limitNum = Math.max(toNumber(limit) || 12, 1)

  const data = withPublishedDb((db) => {
    const targetComplex = complexId ? db.complexes.find((c) => c.id === complexId) : null
    const targetComplexExternalId = targetComplex?.external_id
    const filtered = db.properties
      .filter((p) => p.status === 'active')
      .filter((p) => p.category === cat)
      .filter((p) => (complexId ? (p.complex_id === complexId || (targetComplexExternalId ? p.complex_external_id === targetComplexExternalId : false)) : true))
      .filter((p) => (typeof bed === 'number' ? p.bedrooms === bed : true))
      .filter((p) => (typeof min === 'number' ? p.price >= min : true))
      .filter((p) => (typeof max === 'number' ? p.price <= max : true))
      .filter((p) => (typeof amin === 'number' ? p.area_total >= amin : true))
      .filter((p) => (typeof amax === 'number' ? p.area_total <= amax : true))
      .filter((p) => (districtLc ? p.district.toLowerCase() === districtLc : true))
      .filter((p) => (metroLc ? p.metro.some((m) => m.toLowerCase() === metroLc) : true))
      .filter((p) => (qlc ? p.title.toLowerCase().includes(qlc) || p.district.toLowerCase().includes(qlc) || p.metro.some((m) => m.toLowerCase().includes(qlc)) : true))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    const total = filtered.length
    const start = (pageNum - 1) * limitNum
    const end = start + limitNum
    const properties = filtered.slice(start, end)

    const complexes =
      tab === 'newbuild'
        ? db.complexes
            .filter((c) => c.status === 'active')
            .filter((c) => (complexId ? c.id === complexId : true))
            .filter((c) => (districtLc ? c.district.toLowerCase() === districtLc : true))
            .filter((c) => (metroLc ? c.metro.some((m) => m.toLowerCase() === metroLc) : true))
            .filter((c) => (qlc ? c.title.toLowerCase().includes(qlc) || c.district.toLowerCase().includes(qlc) || c.metro.some((m) => m.toLowerCase().includes(qlc)) : true))
            .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
        : []

    return { properties, complexes, total, page: pageNum, limit: limitNum }
  })

  res.json({ success: true, data })
})

router.get('/property/:idOrSlug', (req: Request, res: Response) => {
  const idOrSlug = req.params.idOrSlug
  const data = withPublishedDb((db) => {
    const property = db.properties.find(
      (p) => p.status === 'active' && (p.slug === idOrSlug || p.id === idOrSlug),
    )
    if (!property) return null
    const complex = property.complex_id ? db.complexes.find((c) => c.id === property.complex_id) : undefined
    return { property, complex }
  })
  if (!data) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true, data })
})

router.get('/complex/:idOrSlug', (req: Request, res: Response) => {
  const idOrSlug = req.params.idOrSlug
  const data = withPublishedDb((db) => {
    const complex = db.complexes.find(
      (c) => c.status === 'active' && (c.slug === idOrSlug || c.id === idOrSlug),
    )
    if (!complex) return null
    const properties = db.properties
      .filter((p) => p.status === 'active')
      .filter((p) => (p.complex_id ? p.complex_id === complex.id : p.complex_external_id === complex.external_id))
      .sort((a, b) => a.price - b.price)
    return { complex, properties }
  })
  if (!data) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true, data })
})

router.get('/collection/:idOrSlug', (req: Request, res: Response) => {
  const idOrSlug = req.params.idOrSlug
  const data = withPublishedDb((db) => {
    const collection = db.collections.find(
      (c) => c.slug === idOrSlug || c.id === idOrSlug,
    )
    if (!collection) return null

    // Check if collection is visible
    if (collection.status !== 'visible') return null

    const items = resolveCollectionItems(collection, db)

    return { collection, items }
  })
  if (!data) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true, data })
})

// Proxy for geocoding: Yandex first, Nominatim fallback
router.get('/geocode', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.json({ success: true, data: null })

  const t0 = Date.now()
  console.log(`[geocode] query="${q}"`)

  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : ''
    const moscowFirstRaw = typeof req.query.moscowFirst === 'string' ? req.query.moscowFirst.trim().toLowerCase() : ''
    const moscowByFlag = moscowFirstRaw === '1' || moscowFirstRaw === 'true' || moscowFirstRaw === 'yes'
    const moscowByCity = /(?:\u043c\u043e\u0441\u043a|moscow)/i.test(city)
    const moscowFirst = moscowByFlag || moscowByCity
    const cacheKey = `${q}|${city}|${moscowFirst ? '1' : '0'}`

    const now = Date.now()
    const cached = geocodeResultCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      console.log(`[geocode] cache hit → ${cached.data ? `lat=${cached.data.lat} lon=${cached.data.lon}` : 'null'}`)
      return res.json({
        success: true,
        data: cached.data,
        debug: {
          source: 'cache',
          totalMs: Date.now() - t0,
        },
      })
    }

    const geocodeDebug: {
      source: 'cache' | 'yandex' | 'nominatim' | 'none'
      yandex: { attempted: boolean; attempts: YandexGeocodeAttemptDebug[]; hitQuery?: string }
      nominatim: { attempted: boolean; attempts: string[]; hadTransientError: boolean }
      totalMs?: number
    } = {
      source: 'none',
      yandex: {
        attempted: false,
        attempts: [],
      },
      nominatim: {
        attempted: false,
        attempts: [],
        hadTransientError: false,
      },
    }

    // ── Yandex Geocoder (primary, works reliably on prod servers) ──────────
    try {
      const db = readDb()
      const yandexKey = (db.home?.maps?.yandex_maps_api_key || '').trim()
      if (yandexKey) {
        const yandexDeadlineAt = Date.now() + 7500
        const yandexQueries = buildGeocodeQueryVariants(q, city).slice(0, 5)
        geocodeDebug.yandex.attempted = yandexQueries.length > 0

        for (const query of yandexQueries) {
          const timeLeft = yandexDeadlineAt - Date.now()
          if (timeLeft < 700) break

          const timeoutMs = Math.min(3200, Math.max(1400, timeLeft))
          console.log(`[geocode] trying Yandex Geocoder query="${query}" timeoutMs=${timeoutMs}`)
          const yandexResult = await fetchYandexGeocode(query, yandexKey, {
            timeoutMs,
            moscowOnly: moscowFirst,
          })
          geocodeDebug.yandex.attempts.push(yandexResult.debug)

          if (yandexResult.point) {
            geocodeDebug.source = 'yandex'
            geocodeDebug.yandex.hitQuery = query
            geocodeDebug.totalMs = Date.now() - t0
            console.log(`[geocode] Yandex OK → lat=${yandexResult.point.lat} lon=${yandexResult.point.lon} ms=${Date.now() - t0} query="${query}"`)
            geocodeResultCache.set(cacheKey, {
              data: { lat: yandexResult.point.lat, lon: yandexResult.point.lon, score: 200 },
              expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
            })
            return res.json({
              success: true,
              data: { lat: yandexResult.point.lat, lon: yandexResult.point.lon, score: 200 },
              debug: geocodeDebug,
            })
          }
        }
        const yandexSummary = geocodeDebug.yandex.attempts.map((attempt) => `${attempt.query}:${attempt.status}`).join(', ')
        console.warn(`[geocode] Yandex no hit for query="${q}" attempts=[${yandexSummary}]`)
      } else {
        console.warn('[geocode] Yandex key not configured → skipping Yandex, falling back to Nominatim')
      }
    } catch (yErr) {
      console.error(`[geocode] Yandex error: ${yErr instanceof Error ? yErr.message : String(yErr)} → falling back to Nominatim`)
    }

    // ── Nominatim fallback ─────────────────────────────────────────────────
    console.log(`[geocode] trying Nominatim city="${city}" moscowFirst=${moscowFirst}`)
    const candidateQueries = buildGeocodeQueryVariants(q, city).slice(0, 4)
    geocodeDebug.nominatim.attempted = candidateQueries.length > 0
    const deadlineAt = Date.now() + GEOCODE_ROUTE_MAX_MS

    const paramsQueue: Array<{ params: URLSearchParams; query: string; mode: 'bounded' | 'global' }> = []
    candidateQueries.forEach((candidate, index) => {
      if (moscowFirst) {
        paramsQueue.push({
          query: candidate,
          mode: 'bounded',
          params: new URLSearchParams({
            q: candidate,
            format: 'json',
            limit: '5',
            addressdetails: '1',
            countrycodes: 'ru',
            viewbox: MOSCOW_VIEWBOX,
            bounded: '1',
          }),
        })
      }

      const shouldTryGlobalSearch = !moscowFirst || index === 0
      if (shouldTryGlobalSearch) {
        paramsQueue.push({
          query: candidate,
          mode: 'global',
          params: new URLSearchParams({
            q: candidate,
            format: 'json',
            limit: '5',
            addressdetails: '1',
            countrycodes: 'ru',
          }),
        })
      }
    })

    let best: RankedCandidate | null = null
    const seen = new Set<string>()
    let hadTransientError = false

    for (const attempt of paramsQueue) {
      geocodeDebug.nominatim.attempts.push(`${attempt.query} [${attempt.mode}]`)
      if (Date.now() >= deadlineAt) {
        console.warn('[geocode] Nominatim deadline exceeded')
        hadTransientError = true
        geocodeDebug.nominatim.hadTransientError = true
        break
      }

      const fetched = await fetchNominatimCandidates(attempt.params, deadlineAt)
      if (fetched.transientError) {
        hadTransientError = true
        geocodeDebug.nominatim.hadTransientError = true
        console.warn(`[geocode] Nominatim transient error for query="${attempt.query}"`)
      }
      if (fetched.transientError && fetched.candidates.length === 0 && !best) break

      for (const candidate of fetched.candidates) {
        const rankedCandidate = buildCandidateScore(candidate, attempt.query, moscowFirst)
        if (!rankedCandidate) continue

        const key = `${rankedCandidate.lat.toFixed(6)}|${rankedCandidate.lon.toFixed(6)}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!best || rankedCandidate.score > best.score) best = rankedCandidate
      }

      if (best && best.score >= STRONG_GEOCODE_SCORE) {
        console.log(`[geocode] Nominatim strong hit score=${best.score} lat=${best.lat} lon=${best.lon} ms=${Date.now() - t0}`)
        geocodeDebug.source = 'nominatim'
        geocodeDebug.totalMs = Date.now() - t0
        geocodeResultCache.set(cacheKey, {
          data: { lat: best.lat, lon: best.lon, score: best.score, display_name: best.displayName },
          expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
        })
        return res.json({
          success: true,
          data: { lat: best.lat, lon: best.lon, score: best.score, display_name: best.displayName },
          debug: geocodeDebug,
        })
      }
    }

    if (!best) {
      console.warn(`[geocode] RESULT: not found q="${q}" hadTransientError=${hadTransientError} ms=${Date.now() - t0}`)
      if (!hadTransientError) {
        geocodeResultCache.set(cacheKey, { data: null, expiresAt: Date.now() + GEOCODE_NEGATIVE_CACHE_TTL_MS })
      }
      geocodeDebug.totalMs = Date.now() - t0
      return res.json({ success: true, data: null, debug: geocodeDebug })
    }

    console.log(`[geocode] Nominatim weak hit score=${best.score} lat=${best.lat} lon=${best.lon} ms=${Date.now() - t0}`)
    geocodeDebug.source = 'nominatim'
    geocodeDebug.totalMs = Date.now() - t0
    geocodeResultCache.set(cacheKey, {
      data: { lat: best.lat, lon: best.lon, score: best.score, display_name: best.displayName },
      expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
    })
    return res.json({
      success: true,
      data: { lat: best.lat, lon: best.lon, score: best.score, display_name: best.displayName },
      debug: geocodeDebug,
    })
  } catch (err) {
    console.error(`[geocode] unhandled error: ${err instanceof Error ? err.message : String(err)} ms=${Date.now() - t0}`)
    return res.json({ success: true, data: null })
  }
})

export default router
