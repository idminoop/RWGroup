import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { CatalogTab, Category } from '../../shared/types.js'
import { withPublishedDb } from '../lib/storage.js'
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
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const NOMINATIM_TIMEOUT_MS = 3200
const STRONG_GEOCODE_SCORE = 175
const GEOCODE_CACHE_TTL_MS = 15 * 60 * 1000

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

type RankedCandidate = {
  lat: number
  lon: number
  score: number
  displayName?: string
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

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !GEOCODE_STOPWORDS.has(item))
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
  if (/\b(деревн|село|пос[её]лок|village|hamlet)\b/i.test(text)) return -70
  return 0
}

function buildCandidateScore(candidate: NominatimCandidate, query: string, moscowFirst: boolean): RankedCandidate | null {
  const lat = Number.parseFloat(candidate.lat)
  const lon = Number.parseFloat(candidate.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  if (moscowFirst && !isWithinMoscowBounds(lat, lon)) return null

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
  const tokenHits = queryTokens.reduce((acc, token) => (candidateText.includes(token) ? acc + 1 : acc), 0)
  const hasHouseInQuery = /\b\d+[a-zа-я]?\b/ui.test(query)
  const candidateHouse = candidate.address?.house_number || ''
  const houseMatched = hasHouseInQuery && candidateHouse ? query.toLowerCase().includes(candidateHouse.toLowerCase()) : false

  let score = 0
  score += tokenHits * 22
  score += Math.round((candidate.importance || 0) * 100)
  score += isWithinMoscowBounds(lat, lon) ? 30 : -200
  score += roadLikePenalty(candidate.class, candidate.type)
  score += localityPenalty(displayName)

  if (candidate.class === 'building') score += 40
  if (candidate.type === 'house') score += 40
  if (candidate.class === 'place') score -= 35
  if (candidate.type === 'neighbourhood') score -= 12

  if (hasHouseInQuery) score += houseMatched ? 35 : -12
  if (tokenHits === 0) score -= 40
  if (tokenHits >= Math.max(2, Math.floor(queryTokens.length / 2))) score += 25

  return { lat, lon, score, displayName }
}

async function fetchNominatimCandidates(params: URLSearchParams): Promise<NominatimCandidate[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS)

  try {
    const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, {
      headers: {
        'Accept-Language': 'ru',
        'User-Agent': 'RWGroupWebsite/1.0',
      },
      signal: controller.signal,
    })
    if (!response.ok) return []
    const json = await response.json() as NominatimCandidate[]
    return Array.isArray(json) ? json : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
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

router.get('/property/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const data = withPublishedDb((db) => {
    const property = db.properties.find((p) => p.id === id && p.status === 'active')
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

router.get('/complex/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const data = withPublishedDb((db) => {
    const complex = db.complexes.find((c) => c.id === id && c.status === 'active')
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

router.get('/collection/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const data = withPublishedDb((db) => {
    const collection = db.collections.find((c) => c.id === id)
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

// Proxy for Nominatim geocoding (CORS workaround)
router.get('/geocode', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.json({ success: true, data: null })

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
      return res.json({ success: true, data: cached.data })
    }

    const qLc = q.toLowerCase()
    const cityLc = city.toLowerCase()
    const candidateQueries = Array.from(
      new Set(
        [
          q,
          city && !qLc.includes(cityLc) ? `${q}, ${city}` : '',
        ]
          .map((item) => item.trim())
          .filter(Boolean)
      )
    )

    const paramsQueue: Array<{ params: URLSearchParams; query: string }> = []
    const prioritizedCandidates = candidateQueries.slice(0, 2)
    prioritizedCandidates.forEach((candidate, index) => {
      if (moscowFirst) {
        paramsQueue.push({
          query: candidate,
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

      // Keep global fallback only for the first query to avoid long chains.
      if (index === 0) {
        paramsQueue.push({
          query: candidate,
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

    for (const attempt of paramsQueue) {
      const candidates = await fetchNominatimCandidates(attempt.params)
      for (const candidate of candidates) {
        const rankedCandidate = buildCandidateScore(candidate, attempt.query, moscowFirst)
        if (!rankedCandidate) continue

        const key = `${rankedCandidate.lat.toFixed(6)}|${rankedCandidate.lon.toFixed(6)}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!best || rankedCandidate.score > best.score) best = rankedCandidate
      }

      if (best && best.score >= STRONG_GEOCODE_SCORE) {
        geocodeResultCache.set(cacheKey, {
          data: {
            lat: best.lat,
            lon: best.lon,
            score: best.score,
            display_name: best.displayName,
          },
          expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
        })
        return res.json({
          success: true,
          data: {
            lat: best.lat,
            lon: best.lon,
            score: best.score,
            display_name: best.displayName,
          },
        })
      }
    }

    if (!best) {
      geocodeResultCache.set(cacheKey, {
        data: null,
        expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
      })
      return res.json({ success: true, data: null })
    }

    geocodeResultCache.set(cacheKey, {
      data: {
        lat: best.lat,
        lon: best.lon,
        score: best.score,
        display_name: best.displayName,
      },
      expiresAt: Date.now() + GEOCODE_CACHE_TTL_MS,
    })
    return res.json({
      success: true,
      data: {
        lat: best.lat,
        lon: best.lon,
        score: best.score,
        display_name: best.displayName,
      },
    })
  } catch {
    return res.json({ success: true, data: null })
  }
})

export default router
