import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { CatalogTab, Category } from '../../shared/types.js'
import { withDb } from '../lib/storage.js'
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
  const data = withDb((db) => {
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
  const data = withDb((db) => {
    const districts = dedupe([...db.complexes, ...db.properties].map((x) => x.district)).sort((a, b) => a.localeCompare(b))
    const metros = dedupe([...db.complexes, ...db.properties].flatMap((x) => x.metro)).sort((a, b) => a.localeCompare(b))
    return { districts, metros }
  })
  res.json({ success: true, data })
})

router.get('/catalog', (req: Request, res: Response) => {
  const schema = z.object({
    tab: z.enum(['newbuild', 'secondary', 'rent']).default('newbuild'),
    bedrooms: z.string().optional(),
    priceMin: z.string().optional(),
    priceMax: z.string().optional(),
    areaMin: z.string().optional(),
    areaMax: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
    q: z.string().optional(),
  })
  const parsed = schema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid query' })
    return
  }
  const { tab, bedrooms, priceMin, priceMax, areaMin, areaMax, q, page, limit } = parsed.data
  const cat = tabToCategory(tab)
  const bed = toNumber(bedrooms)
  const min = toNumber(priceMin)
  const max = toNumber(priceMax)
  const amin = toNumber(areaMin)
  const amax = toNumber(areaMax)
  const qlc = (q || '').trim().toLowerCase()
  const pageNum = Math.max(toNumber(page) || 1, 1)
  const limitNum = Math.max(toNumber(limit) || 12, 1)

  const data = withDb((db) => {
    const filtered = db.properties
      .filter((p) => p.status === 'active')
      .filter((p) => p.category === cat)
      .filter((p) => (typeof bed === 'number' ? p.bedrooms === bed : true))
      .filter((p) => (typeof min === 'number' ? p.price >= min : true))
      .filter((p) => (typeof max === 'number' ? p.price <= max : true))
      .filter((p) => (typeof amin === 'number' ? p.area_total >= amin : true))
      .filter((p) => (typeof amax === 'number' ? p.area_total <= amax : true))
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
            .filter((c) => (qlc ? c.title.toLowerCase().includes(qlc) || c.district.toLowerCase().includes(qlc) || c.metro.some((m) => m.toLowerCase().includes(qlc)) : true))
            .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
        : []

    return { properties, complexes, total, page: pageNum, limit: limitNum }
  })

  res.json({ success: true, data })
})

router.get('/property/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const data = withDb((db) => {
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
  const data = withDb((db) => {
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
  const data = withDb((db) => {
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

export default router
