import type { Complex, ComplexNearbyPlace, NearbyGroup } from '../../shared/types.js'
import { slugify } from './ids.js'
import { readDb } from './storage.js'

type Coords = { lat: number; lon: number }

type CategorySource = 'yandex' | 'overpass'

type CategoryDef = {
  key: string
  label: string
  group: NearbyGroup
  emoji: string
  source: CategorySource
  yandexQuery?: string
  overpassQuery?: string
  fallbackImages: string[]
}

type PoiWithMeta = {
  name: string
  lat: number
  lon: number
  tags?: Record<string, string>
  categoryDef: CategoryDef
  distanceKm: number
  rating?: number
  reviews_count?: number
}

type RoutedPoi = PoiWithMeta & {
  walkMinutes: number
  driveMinutes: number
  interestScore: number
}

type GenerateNearbyOptions = {
  resolveImages?: boolean
  preciseRoutes?: boolean
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

type YandexFeature = {
  geometry: { coordinates: [number, number] }
  properties: {
    name: string
    CompanyMetaData?: {
      name?: string
      address?: string
      Categories?: Array<{ class?: string; name?: string }>
      rating?: { score?: number; count?: number }
    }
  }
}

type YandexSearchResponse = {
  features?: YandexFeature[]
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const YANDEX_SEARCH_URL = 'https://search-maps.yandex.ru/v1/'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const OSRM_BASE_URL = 'https://router.project-osrm.org'

const USER_AGENT = 'RWGroupWebsite/1.0 (+nearby-generator)'
const OVERPASS_TIMEOUT_MS = 8000
const OVERPASS_CATEGORY_DEADLINE_MS = 18000
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
const MOSCOW_LABEL = 'Москва'

const SEARCH_RADIUS_METERS = 2000
const MAX_CANDIDATES_PER_YANDEX_CATEGORY = 10
const MAX_MINUTES = 25
const IMAGE_VARIANTS_LIMIT = 24
const IMAGE_RESOLVE_CONCURRENCY = 4
const MIN_ROUTED_CANDIDATES = 6
const IMAGE_GEOSEARCH_RADIUS_METERS = 420
const IMAGE_GEOSEARCH_LIMIT = 14
const IMAGE_GEOSEARCH_WIDE_RADIUS_METERS = 900
const IMAGE_GEOSEARCH_WIDE_LIMIT = 12

// Yandex quality thresholds
const MIN_RATING = 4.0
const MIN_REVIEWS = 15

const FALLBACK_WALK_M_PER_MIN = 75
const FALLBACK_DRIVE_M_PER_MIN = 450

// 21 categories in 3 groups — all via free Overpass API (OpenStreetMap)
const CATEGORY_DEFS: CategoryDef[] = [
  // ── Group: life (Жизнь рядом) ──────────────────────────────────────────
  {
    key: 'coffee_shop',
    label: 'Кофейня',
    group: 'life',
    emoji: '☕',
    source: 'overpass',
    overpassQuery: 'node["amenity"="cafe"](around:{RADIUS},{LAT},{LON});way["amenity"="cafe"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'cafe',
    label: 'Кафе',
    group: 'life',
    emoji: '🍽️',
    source: 'overpass',
    overpassQuery: 'node["amenity"="fast_food"](around:{RADIUS},{LAT},{LON});way["amenity"="fast_food"](around:{RADIUS},{LAT},{LON});node["amenity"="bistro"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'restaurant',
    label: 'Ресторан',
    group: 'life',
    emoji: '🍷',
    source: 'overpass',
    overpassQuery: 'node["amenity"="restaurant"](around:{RADIUS},{LAT},{LON});way["amenity"="restaurant"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'bakery',
    label: 'Пекарня',
    group: 'life',
    emoji: '🥐',
    source: 'overpass',
    overpassQuery: 'node["shop"="bakery"](around:{RADIUS},{LAT},{LON});way["shop"="bakery"](around:{RADIUS},{LAT},{LON});node["amenity"="cafe"]["cuisine"="bakery"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1517433670267-08bbd4be890f?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1568254183919-78a4f43a2877?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'bar',
    label: 'Бар',
    group: 'life',
    emoji: '🍺',
    source: 'overpass',
    overpassQuery: 'node["amenity"="bar"](around:{RADIUS},{LAT},{LON});way["amenity"="bar"](around:{RADIUS},{LAT},{LON});node["amenity"="pub"](around:{RADIUS},{LAT},{LON});way["amenity"="pub"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1543007631-283050bb3e8c?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'park',
    label: 'Парк',
    group: 'life',
    emoji: '🌿',
    source: 'overpass',
    overpassQuery: 'node["leisure"="park"](around:{RADIUS},{LAT},{LON});way["leisure"="park"](around:{RADIUS},{LAT},{LON});relation["leisure"="park"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'waterfront',
    label: 'Набережная',
    group: 'life',
    emoji: '🌊',
    source: 'overpass',
    overpassQuery: 'way["leisure"="promenade"](around:{RADIUS},{LAT},{LON});node["tourism"="attraction"]["name"~"набережная|набережній|promenade|embankment",i](around:{RADIUS},{LAT},{LON});way["name"~"набережная|набережній|набережная",i](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1499346030926-9a72daac6c63?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'viewpoint',
    label: 'Смотровая',
    group: 'life',
    emoji: '🔭',
    source: 'overpass',
    overpassQuery: 'node["tourism"="viewpoint"](around:{RADIUS},{LAT},{LON});way["tourism"="viewpoint"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1553391977-f5c6893f8df0?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1400&q=80',
    ],
  },

  // ── Group: leisure (Досуг) ─────────────────────────────────────────────
  {
    key: 'museum',
    label: 'Музей',
    group: 'leisure',
    emoji: '🏛️',
    source: 'overpass',
    overpassQuery: 'node["tourism"="museum"](around:{RADIUS},{LAT},{LON});way["tourism"="museum"](around:{RADIUS},{LAT},{LON});relation["tourism"="museum"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1577083552431-6e5fd01988f1?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'theater',
    label: 'Театр',
    group: 'leisure',
    emoji: '🎭',
    source: 'overpass',
    overpassQuery: 'node["amenity"="theatre"](around:{RADIUS},{LAT},{LON});way["amenity"="theatre"](around:{RADIUS},{LAT},{LON});relation["amenity"="theatre"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1503095396549-807759245b35?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'cinema',
    label: 'Кинотеатр',
    group: 'leisure',
    emoji: '🎬',
    source: 'overpass',
    overpassQuery: 'node["amenity"="cinema"](around:{RADIUS},{LAT},{LON});way["amenity"="cinema"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'art_gallery',
    label: 'Галерея',
    group: 'leisure',
    emoji: '🖼️',
    source: 'overpass',
    overpassQuery: 'node["tourism"="gallery"](around:{RADIUS},{LAT},{LON});way["tourism"="gallery"](around:{RADIUS},{LAT},{LON});node["tourism"="artwork"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1531243269054-5ebf6f34081e?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1565799557187-2d87e04ae98b?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'landmark',
    label: 'Достопримечательность',
    group: 'leisure',
    emoji: '🏰',
    source: 'overpass',
    overpassQuery: 'node["tourism"~"attraction|museum|gallery|viewpoint"](around:{RADIUS},{LAT},{LON});node["historic"~"monument|memorial|castle"](around:{RADIUS},{LAT},{LON});way["tourism"="attraction"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1513326738677-b964603b136d?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1465447142348-e9952c393450?auto=format&fit=crop&w=1400&q=80',
    ],
  },

  // ── Group: family (Для семьи и спорта) ───────────────────────────────
  {
    key: 'gym',
    label: 'Фитнес-клуб',
    group: 'family',
    emoji: '💪',
    source: 'overpass',
    overpassQuery: 'node["leisure"="fitness_centre"](around:{RADIUS},{LAT},{LON});way["leisure"="fitness_centre"](around:{RADIUS},{LAT},{LON});node["leisure"="fitness_station"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1486286701208-1d58e9338013?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'yoga',
    label: 'Йога / танцы',
    group: 'family',
    emoji: '🧘',
    source: 'overpass',
    overpassQuery: 'node["sport"="yoga"](around:{RADIUS},{LAT},{LON});way["sport"="yoga"](around:{RADIUS},{LAT},{LON});node["sport"="dance"](around:{RADIUS},{LAT},{LON});way["sport"="dance"](around:{RADIUS},{LAT},{LON});node["leisure"="dance"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'sports_complex',
    label: 'Спорткомплекс',
    group: 'family',
    emoji: '⚽',
    source: 'overpass',
    overpassQuery: 'node["leisure"="sports_centre"](around:{RADIUS},{LAT},{LON});way["leisure"="sports_centre"](around:{RADIUS},{LAT},{LON});relation["leisure"="sports_centre"](around:{RADIUS},{LAT},{LON});node["leisure"="stadium"](around:{RADIUS},{LAT},{LON});way["leisure"="stadium"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1571019613914-85f342c6a11e?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'shopping_mall',
    label: 'Торговый центр',
    group: 'family',
    emoji: '🛍️',
    source: 'overpass',
    overpassQuery: 'node["shop"="mall"](around:{RADIUS},{LAT},{LON});way["shop"="mall"](around:{RADIUS},{LAT},{LON});relation["shop"="mall"](around:{RADIUS},{LAT},{LON});node["shop"="department_store"](around:{RADIUS},{LAT},{LON});way["shop"="department_store"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'coworking',
    label: 'Коворкинг',
    group: 'family',
    emoji: '💻',
    source: 'overpass',
    overpassQuery: 'node["amenity"="coworking_space"](around:{RADIUS},{LAT},{LON});way["amenity"="coworking_space"](around:{RADIUS},{LAT},{LON});node["office"="coworking"](around:{RADIUS},{LAT},{LON});way["office"="coworking"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'playground',
    label: 'Детская площадка',
    group: 'family',
    emoji: '🛝',
    source: 'overpass',
    overpassQuery: 'node["leisure"="playground"](around:{RADIUS},{LAT},{LON});way["leisure"="playground"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1575783970733-1aaedde1db74?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1587536849024-4e4b8f35b98e?auto=format&fit=crop&w=1400&q=80',
    ],
  },
  {
    key: 'kids_center',
    label: 'Детский центр',
    group: 'family',
    emoji: '👶',
    source: 'overpass',
    overpassQuery: 'node["amenity"="childcare"](around:{RADIUS},{LAT},{LON});way["amenity"="childcare"](around:{RADIUS},{LAT},{LON});node["amenity"="kindergarten"](around:{RADIUS},{LAT},{LON});way["amenity"="kindergarten"](around:{RADIUS},{LAT},{LON});node["leisure"="amusement_arcade"](around:{RADIUS},{LAT},{LON});',
    fallbackImages: [
      'https://images.unsplash.com/photo-1526634332515-d56c5fd16991?auto=format&fit=crop&w=1400&q=80',
      'https://images.unsplash.com/photo-1567748157439-651aca2ff064?auto=format&fit=crop&w=1400&q=80',
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

function safeTag(tags: Record<string, string> | undefined, key: string): string {
  const value = tags?.[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function scorePoiItem(item: PoiWithMeta & { walkMinutes: number; driveMinutes: number }): number {
  // For Yandex-sourced places: rating * log(reviews + 1)
  if (item.rating !== undefined && item.reviews_count !== undefined) {
    const quality = item.rating * Math.log(item.reviews_count + 1)
    const proximity = Math.max(0, 1.5 - item.distanceKm * 0.5)
    return quality + proximity
  }

  // For OSM places: tag-based scoring
  const tags = item.tags || {}
  let score = 3.0

  const hasWikiRef = Boolean(
    safeTag(tags, 'wikipedia')
    || safeTag(tags, 'wikidata')
    || safeTag(tags, 'wikimedia_commons')
  )
  if (hasWikiRef) score += 2.0
  if (safeTag(tags, 'historic') || safeTag(tags, 'heritage')) score += 1.5
  const tourism = safeTag(tags, 'tourism')
  if (tourism === 'attraction' || tourism === 'museum' || tourism === 'gallery' || tourism === 'viewpoint') score += 1.2
  if (item.name.trim().length >= 10) score += 0.3

  const bestTravel = Math.min(item.walkMinutes * 0.95, item.driveMinutes * 1.1)
  score += Math.max(-1.5, 3.5 - bestTravel / 5.0)
  score += Math.max(-1.0, 1.5 - item.distanceKm * 0.7)

  return score
}

// Returns up to maxPerCategory candidates per category, sorted by group then category then score.
// The FIRST item in each category group is the auto-selected "best" choice.
function pickAllCandidates(
  items: Array<PoiWithMeta & { walkMinutes: number; driveMinutes: number }>,
  maxPerCategory = 3
): RoutedPoi[] {
  const scored = items
    .map((item) => ({
      ...item,
      interestScore: scorePoiItem(item),
    }))
    .sort((a, b) => b.interestScore - a.interestScore)

  const selected: RoutedPoi[] = []
  const selectedKeys = new Set<string>()
  const perCategory = new Map<string, number>()

  for (const item of scored) {
    const key = poiKey(item)
    if (selectedKeys.has(key)) continue
    const count = perCategory.get(item.categoryDef.key) || 0
    if (count >= maxPerCategory) continue
    selected.push(item)
    selectedKeys.add(key)
    perCategory.set(item.categoryDef.key, count + 1)
  }

  // Sort: group order → category key → score DESC (so first item per category = best)
  const groupOrder: Record<NearbyGroup, number> = { life: 0, leisure: 1, family: 2 }
  return selected.sort((a, b) => {
    const gDiff = groupOrder[a.categoryDef.group] - groupOrder[b.categoryDef.group]
    if (gDiff !== 0) return gDiff
    const catDiff = a.categoryDef.key.localeCompare(b.categoryDef.key)
    if (catDiff !== 0) return catDiff
    return b.interestScore - a.interestScore
  })
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

const overpassCache = new Map<string, OverpassCacheRecord>()
const overpassInFlight = new Map<string, Promise<Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>>>()
const overpassFailedUntil = new Map<string, number>()
const geocodeCache = new Map<string, Coords | null>()
const yandexSearchCache = new Map<string, YandexFeature[]>()
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

async function requestOverpass(endpoint: string, query: string, timeoutMs = OVERPASS_TIMEOUT_MS): Promise<Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>> {
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
    timeoutMs
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

async function fetchOverpassCategory(origin: Coords, category: CategoryDef, radiusMeters: number): Promise<Array<{ name: string; lat: number; lon: number; tags?: Record<string, string> }>> {
  if (!category.overpassQuery) return []
  const key = overpassKey(origin, category.key, radiusMeters)
  const now = Date.now()

  const cached = overpassCache.get(key)
  if (cached && cached.expiresAt > now) return cached.results

  const pending = overpassInFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    const cooldownUntil = overpassFailedUntil.get(key)
    if (typeof cooldownUntil === 'number' && cooldownUntil > Date.now()) return []
    const deadlineAt = Date.now() + OVERPASS_CATEGORY_DEADLINE_MS

    const radii = [radiusMeters]
    if (radiusMeters > 1400) radii.push(Math.max(900, Math.round(radiusMeters * 0.65)))

    for (const radius of radii) {
      if (Date.now() >= deadlineAt) break
      const query = overpassQuery(category.overpassQuery!, origin, radius)
      const endpoints = endpointOrder(key)
      for (const endpoint of endpoints) {
        const timeLeft = deadlineAt - Date.now()
        if (timeLeft <= 1200) break
        try {
          const timeoutMs = Math.min(OVERPASS_TIMEOUT_MS, Math.max(1800, timeLeft))
          const results = await requestOverpass(endpoint, query, timeoutMs)
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
          if (Date.now() >= deadlineAt) break
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

async function fetchYandexCategory(
  origin: Coords,
  category: CategoryDef,
  radiusMeters: number,
  apiKey: string
): Promise<PoiWithMeta[]> {
  if (!category.yandexQuery || !apiKey.trim()) return []

  const cacheKey = `${origin.lat.toFixed(4)}:${origin.lon.toFixed(4)}:${category.key}:${Math.round(radiusMeters)}`
  const cached = yandexSearchCache.get(cacheKey)
  const features = cached !== undefined ? cached : await (async () => {
    const spnLat = (radiusMeters / 111000).toFixed(4)
    const spnLon = (radiusMeters / (111000 * Math.cos(toRad(origin.lat)))).toFixed(4)
    const params = new URLSearchParams({
      text: category.yandexQuery!,
      ll: `${origin.lon},${origin.lat}`,
      spn: `${spnLon},${spnLat}`,
      results: String(MAX_CANDIDATES_PER_YANDEX_CATEGORY),
      lang: 'ru_RU',
      type: 'biz',
      apikey: apiKey,
    })
    try {
      const response = await withTimeout(`${YANDEX_SEARCH_URL}?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 9000)
      if (!response.ok) {
        console.warn(`[nearby] Yandex search ${response.status} for category=${category.key}`)
        yandexSearchCache.set(cacheKey, [])
        return []
      }
      const json = await response.json() as YandexSearchResponse
      const result = Array.isArray(json.features) ? json.features : []
      yandexSearchCache.set(cacheKey, result)
      return result
    } catch (err) {
      console.warn(`[nearby] Yandex fetch error for category=${category.key}:`, err)
      yandexSearchCache.set(cacheKey, [])
      return []
    }
  })()

  return features
    .map((feature) => {
      const [lon, lat] = feature.geometry.coordinates
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
      const meta = feature.properties.CompanyMetaData
      const name = meta?.name || feature.properties.name || ''
      if (normalizeName(name).length <= 1) return null
      const rating = meta?.rating?.score
      const reviews_count = meta?.rating?.count
      // Quality filter: skip places without enough reviews or rating
      if (rating !== undefined && reviews_count !== undefined) {
        if (rating < MIN_RATING || reviews_count < MIN_REVIEWS) return null
      }
      const dist = distanceKm(origin, { lat, lon })
      if (dist > (radiusMeters * 1.2) / 1000) return null
      return {
        name,
        lat,
        lon,
        categoryDef: category,
        distanceKm: dist,
        rating,
        reviews_count,
      } satisfies PoiWithMeta
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => {
      const scoreA = (a.rating !== undefined && a.reviews_count !== undefined)
        ? a.rating * Math.log(a.reviews_count + 1)
        : 0
      const scoreB = (b.rating !== undefined && b.reviews_count !== undefined)
        ? b.rating * Math.log(b.reviews_count + 1)
        : 0
      return scoreB - scoreA || a.distanceKm - b.distanceKm
    })
    .slice(0, 5)
}

const YANDEX_GEOCODER_URL = 'https://geocode-maps.yandex.ru/1.x/'

async function geocodeDistrict(district: string): Promise<Coords | null> {
  const query = district.trim()
  if (!query) return null

  const cached = geocodeCache.get(query)
  if (cached !== undefined) return cached

  const queryLc = query.toLowerCase()
  const cityLc = MOSCOW_LABEL.toLowerCase()
  const queryWithCity = !queryLc.includes(cityLc) ? `${query}, ${MOSCOW_LABEL}` : query

  // Try Yandex Geocoder first (works reliably on production servers)
  try {
    let apiKey = ''
    try { apiKey = (readDb().home?.maps?.yandex_maps_api_key || '').trim() } catch {}
    if (apiKey) {
      const params = new URLSearchParams({
        apikey: apiKey,
        geocode: queryWithCity,
        format: 'json',
        results: '1',
        lang: 'ru_RU',
      })
      const response = await withTimeout(`${YANDEX_GEOCODER_URL}?${params}`, { headers: { 'User-Agent': USER_AGENT } }, 5000)
      if (response.ok) {
        const json = await response.json() as {
          response?: { GeoObjectCollection?: { featureMember?: Array<{ GeoObject?: { Point?: { pos?: string } } }> } }
        }
        const pos = json?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos
        if (pos) {
          const [lonStr, latStr] = pos.trim().split(' ')
          const lat = parseFloat(latStr)
          const lon = parseFloat(lonStr)
          if (Number.isFinite(lat) && Number.isFinite(lon) && isWithinMoscowBounds({ lat, lon })) {
            geocodeCache.set(query, { lat, lon })
            return { lat, lon }
          }
        }
      }
    }
  } catch {
    // fall through to Nominatim
  }

  // Fallback: Nominatim (works on local dev, may be rate-limited on prod)
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
    6000
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

function getCategoryFallbackImages(categoryKey?: string): string[] {
  const lookup = (categoryKey || '').trim().toLowerCase()
  if (!lookup) return []
  const found = CATEGORY_DEFS.find((item) => item.key.toLowerCase() === lookup || item.label.toLowerCase() === lookup)
  return found?.fallbackImages || []
}

function fallbackImageForCategory(categoryDef: CategoryDef, name: string, lat: number, lon: number): { imageUrl: string; variants: string[] } {
  const fallback = categoryDef.fallbackImages || []
  const id = placeId(name, lat, lon)
  const fallbackImage = fallback[Math.abs(id.length) % Math.max(1, fallback.length)] || ''
  const fallbackVariants = Array.from(new Set([fallbackImage, ...fallback].filter(Boolean)))
  return { imageUrl: fallbackImage, variants: fallbackVariants }
}

function buildPhotoSearchQueries(name: string, district?: string, categoryLabel?: string): string[] {
  const nameVariants = buildNameSearchVariants(name)
  const districtPart = district ? normalizeName(district).split(' ').filter((item) => !PHOTO_SEARCH_STOPWORDS.has(item)).join(' ').trim() : ''
  const categoryPart = categoryLabel
    ? normalizeName(categoryLabel).split(' ').filter((item) => !PHOTO_SEARCH_STOPWORDS.has(item)).join(' ').trim()
    : ''

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

async function resolvePlaceImagesForOverpass(
  poi: PoiWithMeta,
  district: string
): Promise<{ imageUrl: string; variants: string[]; fallback: boolean }> {
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

  const searchQueries = buildPhotoSearchQueries(poi.name, district, poi.categoryDef.label)
  for (let i = 0; i < searchQueries.length && variants.length < IMAGE_VARIANTS_LIMIT; i += 1) {
    const includeOpenverse = variants.length < 8 && i >= 2
    const searched = await searchPhotoVariantsByQuery(searchQueries[i], 12, includeOpenverse)
    pushUniqueUrls(variants, searched, IMAGE_VARIANTS_LIMIT)
  }

  if (variants.length > 0) {
    return { imageUrl: variants[0], variants, fallback: false }
  }

  const fb = fallbackImageForCategory(poi.categoryDef, poi.name, poi.lat, poi.lon)
  return { imageUrl: fb.imageUrl, variants: fb.variants, fallback: true }
}

async function resolvePlaceImagesForYandex(
  poi: PoiWithMeta,
  district: string
): Promise<{ imageUrl: string; variants: string[]; fallback: boolean }> {
  const variants: string[] = []

  if (poi.lat && poi.lon) {
    const nearImages = await searchPhotoVariantsNearPoint({ lat: poi.lat, lon: poi.lon }, poi.name, 14)
    pushUniqueUrls(variants, nearImages, IMAGE_VARIANTS_LIMIT)
  }

  const searchQueries = buildPhotoSearchQueries(poi.name, district, poi.categoryDef.label)
  for (let i = 0; i < searchQueries.length && variants.length < IMAGE_VARIANTS_LIMIT; i += 1) {
    const includeOpenverse = variants.length < 8 && i >= 2
    const searched = await searchPhotoVariantsByQuery(searchQueries[i], 12, includeOpenverse)
    pushUniqueUrls(variants, searched, IMAGE_VARIANTS_LIMIT)
  }

  if (variants.length > 0) {
    return { imageUrl: variants[0], variants, fallback: false }
  }

  const fb = fallbackImageForCategory(poi.categoryDef, poi.name, poi.lat, poi.lon)
  return { imageUrl: fb.imageUrl, variants: fb.variants, fallback: true }
}

// Public Overpass instances are sensitive to burst load; moderate concurrency is more reliable.
const OVERPASS_COLLECT_CONCURRENCY = 3

async function fetchCategoryWithLog(
  origin: Coords,
  categoryDef: CategoryDef,
  apiKey: string
): Promise<PoiWithMeta[]> {
  const t0 = Date.now()
  if (categoryDef.source === 'yandex') {
    const items = await fetchYandexCategory(origin, categoryDef, SEARCH_RADIUS_METERS, apiKey)
    console.log(`[nearby] category=${categoryDef.key} source=yandex found=${items.length} ms=${Date.now() - t0}`)
    return items
  }
  const pois = await fetchOverpassCategory(origin, categoryDef, SEARCH_RADIUS_METERS)
  const items = pois
    .map((poi) => ({
      name: poi.name || categoryDef.label,
      lat: poi.lat,
      lon: poi.lon,
      tags: poi.tags,
      categoryDef,
      distanceKm: distanceKm(origin, { lat: poi.lat, lon: poi.lon }),
    } satisfies PoiWithMeta))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 5)
  const status = items.length === 0 ? 'EMPTY' : 'ok'
  console.log(`[nearby] category=${categoryDef.key} source=overpass found=${items.length} status=${status} ms=${Date.now() - t0}`)
  return items
}

async function collectAllCandidates(origin: Coords, apiKey: string): Promise<PoiWithMeta[]> {
  console.log(`[nearby] collectAllCandidates start lat=${origin.lat.toFixed(5)} lon=${origin.lon.toFixed(5)} categories=${CATEGORY_DEFS.length} concurrency=${OVERPASS_COLLECT_CONCURRENCY}`)
  const t0 = Date.now()

  // Use limited concurrency to avoid Overpass rate-limiting (21 parallel → throttled)
  const results = await mapWithConcurrency(
    CATEGORY_DEFS,
    OVERPASS_COLLECT_CONCURRENCY,
    (categoryDef) => fetchCategoryWithLog(origin, categoryDef, apiKey)
  )

  const merged = results.flat()
  // Deduplicate by name+position
  const deduped: PoiWithMeta[] = []
  const seen = new Set<string>()
  for (const item of merged) {
    const key = normalizeName(item.name) || `${item.lat.toFixed(4)}_${item.lon.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }

  const emptyCats = CATEGORY_DEFS.filter((_, i) => results[i].length === 0).map((c) => c.key)
  console.log(`[nearby] collectAllCandidates done total=${deduped.length} ms=${Date.now() - t0}`)
  if (emptyCats.length > 0) {
    console.warn(`[nearby] EMPTY categories (${emptyCats.length}): ${emptyCats.join(', ')}`)
  }

  return deduped
}

export async function generateNearbyPlacesForComplex(
  complex: Complex,
  originOverride?: Coords,
  options: GenerateNearbyOptions = {}
): Promise<{ origin: Coords | null; items: ComplexNearbyPlace[]; autoSelectedIds: string[]; reason?: string; no_api_key?: boolean }> {
  const origin = normalizeCoords(originOverride) || await resolveComplexCoords(complex)
  if (!origin) {
    return { origin: null, items: [], autoSelectedIds: [], reason: 'Unable to resolve complex coordinates' }
  }

  // Get Yandex API key from DB
  let apiKey = ''
  try {
    const db = readDb()
    apiKey = (db.home?.maps?.yandex_maps_api_key || '').trim()
  } catch {
    // continue without API key (OSM only)
  }

  const noApiKey = !apiKey
  console.log(`[nearby] generate start complex="${complex.title || complex.id}" origin=${origin.lat.toFixed(5)},${origin.lon.toFixed(5)} resolveImages=${options.resolveImages !== false} preciseRoutes=${options.preciseRoutes !== false} apiKey=${apiKey ? 'set' : 'MISSING'}`)

  const candidates = await collectAllCandidates(origin, apiKey)
  if (!candidates.length) {
    console.warn('[nearby] generate result: 0 candidates — check Overpass connectivity or coordinates')
    return { origin, items: [], autoSelectedIds: [], no_api_key: noApiKey }
  }

  const preciseRoutes = options.preciseRoutes !== false
  const destinations = candidates.map((item) => ({ lat: item.lat, lon: item.lon }))
  const walk: Array<number | null> = []
  const drive: Array<number | null> = []

  if (preciseRoutes) {
    const [walkResult, driveResult] = await Promise.allSettled([
      osrmTableBatched('walking', origin, destinations),
      osrmTableBatched('driving', origin, destinations),
    ])
    if (walkResult.status === 'fulfilled') walk.push(...walkResult.value)
    if (driveResult.status === 'fulfilled') drive.push(...driveResult.value)
  }

  const routedCandidates = candidates.map((item, index) => ({
    ...item,
    walkMinutes: walk[index] ?? fallbackWalkMinutes(item.distanceKm),
    driveMinutes: drive[index] ?? fallbackDriveMinutes(item.distanceKm),
  }))

  const withinTravel = routedCandidates.filter((item) => item.walkMinutes <= MAX_MINUTES || item.driveMinutes <= MAX_MINUTES)
  const pool = withinTravel.length >= MIN_ROUTED_CANDIDATES ? withinTravel : routedCandidates

  // Pick up to 3 candidates per category (sorted: best first within each category)
  const picked = pickAllCandidates(pool, 3)
  const resolveImages = options.resolveImages !== false

  const toComplexNearbyPlace = (item: RoutedPoi, image: { imageUrl: string; variants: string[]; fallback: boolean }): ComplexNearbyPlace => ({
    id: placeId(item.name, item.lat, item.lon),
    name: item.name || item.categoryDef.label,
    category: item.categoryDef.label,
    category_key: item.categoryDef.key,
    group: item.categoryDef.group,
    lat: item.lat,
    lon: item.lon,
    walk_minutes: item.walkMinutes,
    drive_minutes: item.driveMinutes,
    rating: item.rating,
    reviews_count: item.reviews_count,
    image_url: image.imageUrl,
    image_variants: image.variants,
    image_fallback: image.fallback || undefined,
  })

  if (!resolveImages) {
    const items = picked.map((item) => {
      const fb = fallbackImageForCategory(item.categoryDef, item.name, item.lat, item.lon)
      return toComplexNearbyPlace(item, { imageUrl: fb.imageUrl, variants: fb.variants, fallback: true })
    })
    // auto-selected: first (best) item per category
    const seenCats = new Set<string>()
    const autoSelectedIds = items
      .filter((item) => {
        if (!item.category_key || seenCats.has(item.category_key)) return false
        seenCats.add(item.category_key)
        return true
      })
      .map((item) => item.id)
    return { origin, items, autoSelectedIds, no_api_key: noApiKey }
  }

  // For resolveImages path, only resolve images for the best 1 per category (auto-selected)
  const seenCatsForResolve = new Set<string>()
  const pickedForImages = picked.filter((item) => {
    if (seenCatsForResolve.has(item.categoryDef.key)) return false
    seenCatsForResolve.add(item.categoryDef.key)
    return true
  })

  const resolvedItems = await mapWithConcurrency(
    pickedForImages,
    IMAGE_RESOLVE_CONCURRENCY,
    async (item) => {
      const resolveImagesForItem = item.categoryDef.source === 'yandex'
        ? resolvePlaceImagesForYandex(item, complex.district || '')
        : resolvePlaceImagesForOverpass(item, complex.district || '')
      const image = await resolveImagesForItem.catch(() => {
        const fb = fallbackImageForCategory(item.categoryDef, item.name, item.lat, item.lon)
        return { imageUrl: fb.imageUrl, variants: fb.variants, fallback: true }
      })
      return toComplexNearbyPlace(item, image)
    }
  )

  // Alternatives (non-best per category) get fallback images
  const resolvedIds = new Set(resolvedItems.map((item) => item.id))
  const alternativeItems = picked
    .filter((item) => !resolvedIds.has(placeId(item.name, item.lat, item.lon)))
    .map((item) => {
      const fb = fallbackImageForCategory(item.categoryDef, item.name, item.lat, item.lon)
      return toComplexNearbyPlace(item, { imageUrl: fb.imageUrl, variants: fb.variants, fallback: true })
    })

  const items = [...resolvedItems, ...alternativeItems].sort((a, b) => {
    const groupOrder: Record<string, number> = { life: 0, leisure: 1, family: 2 }
    const gDiff = (groupOrder[a.group || ''] ?? 9) - (groupOrder[b.group || ''] ?? 9)
    if (gDiff !== 0) return gDiff
    return (a.category_key || '').localeCompare(b.category_key || '')
  })

  const autoSelectedIds = resolvedItems.map((item) => item.id)
  return { origin, items, autoSelectedIds, no_api_key: noApiKey }
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
