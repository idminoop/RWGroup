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

// Прокси для Nominatim геокодинга (обход CORS)
router.get('/geocode', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.json({ success: true, data: null })

  try {
    const params = new URLSearchParams({
      q,
      format: 'json',
      limit: '1',
      countrycodes: 'ru',
    })
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        'Accept-Language': 'ru',
        'User-Agent': 'RWGroupWebsite/1.0',
      },
    })
    if (!resp.ok) return res.json({ success: true, data: null })

    const json = (await resp.json()) as Array<{ lat: string; lon: string; display_name: string }>
    if (!json.length) return res.json({ success: true, data: null })

    res.json({
      success: true,
      data: { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) },
    })
  } catch {
    res.json({ success: true, data: null })
  }
})

export default router
