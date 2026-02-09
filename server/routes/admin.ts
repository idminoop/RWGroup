import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { adminAuth } from '../middleware/adminAuth.js'
import { withDb } from '../lib/storage.js'
import { newId, slugify } from '../lib/ids.js'
import { resolveCollectionItems } from '../lib/collections.js'
import fs from 'fs'
import path from 'path'
import { 
  upsertComplexes, 
  upsertProperties, 
  upsertComplexesFromProperties,
  aggregateComplexesFromRows,
  mapRowToProperty, 
  mapRowToComplex, 
  normalizeYandexRealty,
  asString,
  asNumber,
  asStringArray,
  getField,
  normalizeStatus,
  normalizeCategory,
  normalizeDealType
} from '../lib/import-logic.js'
import type { Category, Complex, DbShape, Property } from '../../shared/types.js'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

router.post('/login', (req: Request, res: Response) => {
  const schema = z.object({ password: z.string().min(1) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const expected = process.env.ADMIN_PASSWORD || 'admin'
  if (parsed.data.password !== expected) {
    res.status(401).json({ success: false, error: 'Invalid password' })
    return
  }
  res.json({ success: true, data: { token: process.env.ADMIN_TOKEN || 'dev-token' } })
})

router.use(adminAuth)

router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No file provided' })
    return
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase()
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif']
    if (!allowed.includes(ext)) {
      res.status(400).json({ success: false, error: 'Invalid file type' })
      return
    }

    const filename = `${newId()}${ext}`
    const uploadsDir = path.join(process.cwd(), 'server', 'uploads')
    
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true })
    }

    const filePath = path.join(uploadsDir, filename)
    fs.writeFileSync(filePath, req.file.buffer)

    res.json({ success: true, data: { url: `/uploads/${filename}` } })
  } catch (e) {
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Upload failed' })
  }
})

router.get('/home', (req: Request, res: Response) => {
  const data = withDb((db) => db.home)
  res.json({ success: true, data })
})

router.put('/home', (req: Request, res: Response) => {
  const schema = z.object({ home: z.any() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  withDb((db) => {
    db.home = { ...db.home, ...(parsed.data.home as DbShape['home']), updated_at: new Date().toISOString() }
  })
  res.json({ success: true })
})

router.get('/leads', (req: Request, res: Response) => {
  const data = withDb((db) => db.leads)
  res.json({ success: true, data })
})

router.get('/feeds', (req: Request, res: Response) => {
  const data = withDb((db) => db.feed_sources)
  res.json({ success: true, data })
})

router.post('/feeds', (req: Request, res: Response) => {
  const schema = z.object({ 
    name: z.string().min(1), 
    mode: z.enum(['upload', 'url']), 
    url: z.string().optional(), 
    format: z.enum(['xlsx', 'csv', 'xml', 'json']),
    mapping: z.record(z.string()).optional()
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const id = newId()
  withDb((db) => {
    db.feed_sources.unshift({
      id,
      name: parsed.data.name,
      mode: parsed.data.mode,
      url: parsed.data.url,
      format: parsed.data.format,
      is_active: true,
      mapping: parsed.data.mapping,
      created_at: new Date().toISOString(),
    })
  })
  res.json({ success: true, data: { id } })
})

router.put('/feeds/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const schema = z.object({
    name: z.string().min(1).optional(),
    mode: z.enum(['upload', 'url']).optional(),
    url: z.string().optional(),
    format: z.enum(['xlsx', 'csv', 'xml', 'json']).optional(),
    is_active: z.boolean().optional(),
    mapping: z.record(z.string()).optional(),
    auto_refresh: z.boolean().optional(),
    refresh_interval_hours: z.number().min(1).max(168).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const ok = withDb((db) => {
    const fs = db.feed_sources.find((x) => x.id === id)
    if (!fs) return false
    Object.assign(fs, parsed.data)
    return true
  })
  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true })
})

router.delete('/feeds/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const ok = withDb((db) => {
    const before = db.feed_sources.length
    db.feed_sources = db.feed_sources.filter((x) => x.id !== id)
    
    if (db.feed_sources.length !== before) {
      // Cascade delete properties and complexes associated with this source
      const propsBefore = db.properties.length
      const complexesBefore = db.complexes.length
      
      db.properties = db.properties.filter((p) => p.source_id !== id)
      db.complexes = db.complexes.filter((c) => c.source_id !== id)
      
      // console.log(`Deleted feed ${id}: removed ${propsBefore - db.properties.length} properties and ${complexesBefore - db.complexes.length} complexes`)
      return true
    }
    return false
  })
  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true })
})

router.get('/collections', (req: Request, res: Response) => {
  const data = withDb((db) => db.collections.sort((a, b) => b.priority - a.priority))
  res.json({ success: true, data })
})

router.post('/collections', (req: Request, res: Response) => {
  const autoRulesSchema = z.object({
    type: z.enum(['property', 'complex']),
    category: z.enum(['newbuild', 'secondary', 'rent']).optional(),
    bedrooms: z.number().int().min(0).max(4).optional(),
    priceMin: z.number().min(0).optional(),
    priceMax: z.number().min(0).optional(),
    areaMin: z.number().min(0).optional(),
    areaMax: z.number().min(0).optional(),
    district: z.string().optional(),
    metro: z.array(z.string()).optional(),
    q: z.string().optional(),
  })

  const schema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    cover_image: z.string().optional(),
    priority: z.number().int().optional(),
    status: z.enum(['visible', 'hidden']).optional(),
    mode: z.enum(['manual', 'auto']),
    auto_rules: autoRulesSchema.optional(),
  }).refine(data => {
    // If mode is 'auto', auto_rules must be present
    if (data.mode === 'auto' && !data.auto_rules) return false
    return true
  }, { message: 'auto_rules required when mode is auto' })

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const id = newId()
  withDb((db) => {
    db.collections.unshift({
      id,
      slug: slugify(parsed.data.title),
      title: parsed.data.title,
      description: parsed.data.description,
      cover_image: parsed.data.cover_image,
      priority: parsed.data.priority ?? 0,
      status: parsed.data.status ?? 'visible',
      mode: parsed.data.mode,
      items: [],
      auto_rules: parsed.data.auto_rules as any,
      updated_at: new Date().toISOString(),
    })
  })
  res.json({ success: true, data: { id } })
})

router.put('/collections/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const autoRulesSchema = z.object({
    type: z.enum(['property', 'complex']),
    category: z.enum(['newbuild', 'secondary', 'rent']).optional(),
    bedrooms: z.number().int().min(0).max(4).optional(),
    priceMin: z.number().min(0).optional(),
    priceMax: z.number().min(0).optional(),
    areaMin: z.number().min(0).optional(),
    areaMax: z.number().min(0).optional(),
    district: z.string().optional(),
    metro: z.array(z.string()).optional(),
    q: z.string().optional(),
  })

  const schema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    cover_image: z.string().optional(),
    priority: z.number().int().optional(),
    status: z.enum(['visible', 'hidden']).optional(),
    mode: z.enum(['manual', 'auto']).optional(),
    items: z.array(z.object({ type: z.enum(['property', 'complex']), ref_id: z.string().min(1) })).optional(),
    auto_rules: autoRulesSchema.optional(),
  })

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const ok = withDb((db) => {
    const col = db.collections.find((c) => c.id === id)
    if (!col) return false
    if (parsed.data.title) col.slug = slugify(parsed.data.title)

    // Handle mode switch: clear opposite field
    if (parsed.data.mode && parsed.data.mode !== col.mode) {
      if (parsed.data.mode === 'manual') {
        col.auto_rules = undefined
      } else {
        col.items = []
      }
    }

    Object.assign(col, parsed.data)
    col.updated_at = new Date().toISOString()
    return true
  })
  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true })
})

router.delete('/collections/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const ok = withDb((db) => {
    const before = db.collections.length
    db.collections = db.collections.filter((c) => c.id !== id)
    return db.collections.length !== before
  })
  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true })
})

router.post('/collections/:id/toggle-status', (req: Request, res: Response) => {
  const id = req.params.id
  let newStatus: 'visible' | 'hidden' | null = null
  const ok = withDb((db) => {
    const col = db.collections.find((c) => c.id === id)
    if (!col) return false
    col.status = col.status === 'visible' ? 'hidden' : 'visible'
    newStatus = col.status
    col.updated_at = new Date().toISOString()
    return true
  })
  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true, data: { status: newStatus } })
})

router.get('/collections/:id/preview', (req: Request, res: Response) => {
  const id = req.params.id
  const data = withDb((db) => {
    const collection = db.collections.find((c) => c.id === id)
    if (!collection) return null

    const items = resolveCollectionItems(collection, db)

    if (collection.mode === 'manual') {
      // Validate manual items
      const allRefIds = collection.items.map(it => it.ref_id)
      const validIds = items.map(it => it.ref.id)
      const invalidIds = allRefIds.filter(id => !validIds.includes(id))

      return {
        mode: 'manual' as const,
        items,
        stats: {
          total: collection.items.length,
          valid: validIds.length,
          invalid: invalidIds.length,
          invalidIds,
        },
      }
    } else {
      // Auto mode
      return {
        mode: 'auto' as const,
        items: items.slice(0, 100), // Limit preview to 100 items
        stats: {
          total: items.length,
          valid: items.length,
          invalid: 0,
        },
      }
    }
  })
  if (!data) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true, data })
})

router.post('/collections/preview-auto', (req: Request, res: Response) => {
  const autoRulesSchema = z.object({
    type: z.enum(['property', 'complex']),
    category: z.enum(['newbuild', 'secondary', 'rent']).optional(),
    bedrooms: z.number().int().min(0).max(4).optional(),
    priceMin: z.number().min(0).optional(),
    priceMax: z.number().min(0).optional(),
    areaMin: z.number().min(0).optional(),
    areaMax: z.number().min(0).optional(),
    district: z.string().optional(),
    metro: z.array(z.string()).optional(),
    q: z.string().optional(),
  })

  const schema = z.object({
    rules: autoRulesSchema,
    limit: z.number().int().min(1).max(100).optional(),
  })

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const data = withDb((db) => {
    const collection = {
      id: 'preview',
      slug: 'preview',
      title: 'preview',
      mode: 'auto' as const,
      items: [],
      auto_rules: parsed.data.rules,
      status: 'visible' as const,
      priority: 0,
      updated_at: new Date().toISOString(),
    }

    const items = resolveCollectionItems(collection as any, db)
    const limit = parsed.data.limit ?? 12
    return {
      items: items.slice(0, limit),
      total: items.length,
    }
  })

  res.json({ success: true, data })
})

router.post('/collections/:id/validate-items', (req: Request, res: Response) => {
  const id = req.params.id
  const schema = z.object({ cleanInvalid: z.boolean().optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const result = withDb((db) => {
    const collection = db.collections.find((c) => c.id === id)
    if (!collection || collection.mode !== 'manual') return null

    const validItems = collection.items.filter((it) => {
      if (it.type === 'property') {
        return db.properties.some((p) => p.id === it.ref_id && p.status === 'active')
      } else {
        return db.complexes.some((c) => c.id === it.ref_id && c.status === 'active')
      }
    })

    const invalidIds = collection.items
      .filter(it => !validItems.some(v => v.ref_id === it.ref_id))
      .map(it => it.ref_id)

    if (parsed.data.cleanInvalid && invalidIds.length > 0) {
      collection.items = validItems
      collection.updated_at = new Date().toISOString()
    }

    return {
      totalItems: collection.items.length,
      validItems: validItems.length,
      invalidItems: invalidIds,
      cleaned: parsed.data.cleanInvalid || false,
    }
  })

  if (!result) {
    res.status(404).json({ success: false, error: 'Not found or not in manual mode' })
    return
  }
  res.json({ success: true, data: result })
})

router.get('/catalog/outdated', (req: Request, res: Response) => {
  const data = withDb((db) => {
    const isOutdated = (x: { district: string }) => x.district === 'Array'
    const properties = db.properties.filter(isOutdated).length
    const complexes = db.complexes.filter(isOutdated).length
    return { properties, complexes, total: properties + complexes }
  })
  res.json({ success: true, data })
})

router.get('/catalog/items', (req: Request, res: Response) => {
  const type = req.query.type as string
  const page = Math.max(parseInt(req.query.page as string) || 1, 1)
  const limit = Math.max(parseInt(req.query.limit as string) || 50, 1)
  const bed = toNumber(req.query.bedrooms)
  const min = toNumber(req.query.priceMin)
  const max = toNumber(req.query.priceMax)
  const amin = toNumber(req.query.areaMin)
  const amax = toNumber(req.query.areaMax)
    const qlc = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
    const matchesQuery = (value?: string) =>
      typeof value === 'string' ? value.toLowerCase().includes(qlc) : false
    const matchesMetro = (metro?: string[]) =>
      Array.isArray(metro) ? metro.some((m) => m.toLowerCase().includes(qlc)) : false
  
  if (type !== 'property' && type !== 'complex') {
    res.status(400).json({ success: false, error: 'Invalid type' })
    return
  }

  const data = withDb((db) => {
    const items =
      type === 'property'
          ? db.properties
              .filter((p) => (typeof bed === 'number' ? p.bedrooms === bed : true))
              .filter((p) => (typeof min === 'number' ? p.price >= min : true))
              .filter((p) => (typeof max === 'number' ? p.price <= max : true))
              .filter((p) => (typeof amin === 'number' ? p.area_total >= amin : true))
              .filter((p) => (typeof amax === 'number' ? p.area_total <= amax : true))
              .filter((p) =>
                qlc
                  ? matchesQuery(p.id) || matchesQuery(p.title) || matchesQuery(p.district) || matchesMetro(p.metro)
                  : true
              )
              .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
          : db.complexes
              .filter((c) =>
                qlc
                  ? matchesQuery(c.id) || matchesQuery(c.title) || matchesQuery(c.district) || matchesMetro(c.metro)
                  : true
              )
              .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    const start = (page - 1) * limit
    const end = start + limit
    return {
      items: items.slice(start, end),
      total: items.length,
      page,
      limit
    }
  })
  res.json({ success: true, data })
})

router.put('/catalog/items/:type/:id', (req: Request, res: Response) => {
  const { type, id } = req.params

  // Common fields for both Property and Complex
  const commonFields = {
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    district: z.string().optional(),
    metro: z.array(z.string()).optional(),
    status: z.enum(['active', 'hidden', 'archived']).optional(),
    images: z.array(z.string()).optional(),
  }

  // Property-specific fields
  const propertyFields = {
    ...commonFields,
    deal_type: z.enum(['sale', 'rent']).optional(),
    price: z.number().optional(),
    old_price: z.number().optional(),
    area_total: z.number().optional(),
    area_living: z.number().optional(),
    area_kitchen: z.number().optional(),
    bedrooms: z.number().optional(),
    floor: z.number().optional(),
    floors_total: z.number().optional(),
    lot_number: z.string().optional(),
    renovation: z.string().optional(),
    is_euroflat: z.boolean().optional(),
    building_section: z.string().optional(),
    building_state: z.string().optional(),
    ready_quarter: z.number().optional(),
    built_year: z.number().optional(),
  }

  // Complex-specific fields
  const complexFields = {
    ...commonFields,
    price_from: z.number().optional(),
    area_from: z.number().optional(),
    developer: z.string().optional(),
    handover_date: z.string().optional(),
    class: z.string().optional(),
    finish_type: z.string().optional(),
  }

  const schema = type === 'property' ? z.object(propertyFields) : z.object(complexFields)
  const parsed = schema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error })
    return
  }

  const ok = withDb((db) => {
    if (type === 'property') {
      const item = db.properties.find(p => p.id === id)
      if (!item) return false
      Object.assign(item, parsed.data)
      item.updated_at = new Date().toISOString()
      return true
    } else if (type === 'complex') {
      const item = db.complexes.find(c => c.id === id)
      if (!item) return false
      Object.assign(item, parsed.data)
      item.updated_at = new Date().toISOString()
      return true
    }
    return false
  })

  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true })
})

router.delete('/catalog/items/:type/:id', (req: Request, res: Response) => {
  const { type, id } = req.params
  
  const ok = withDb((db) => {
    if (type === 'property') {
      const initial = db.properties.length
      db.properties = db.properties.filter(p => p.id !== id)
      return db.properties.length !== initial
    } else if (type === 'complex') {
      const initial = db.complexes.length
      db.complexes = db.complexes.filter(c => c.id !== id)
      if (db.complexes.length !== initial) {
        // Cascade delete properties
        const propsBefore = db.properties.length
        db.properties = db.properties.filter(p => p.complex_id !== id)
        // console.log(`Cascaded delete: removed ${propsBefore - db.properties.length} properties for complex ${id}`)
      }
      return db.complexes.length !== initial
    }
    return false
  })

  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true })
})

router.delete('/catalog/reset', (req: Request, res: Response) => {
  withDb((db) => {
    db.properties = []
    db.complexes = []
    // Optional: also clear feed sources if requested, but for now just catalog
    // db.feed_sources = [] 
  })
  res.json({ success: true })
})

router.get('/import/runs', (req: Request, res: Response) => {
  const data = withDb((db) => db.import_runs.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || '')))
  res.json({ success: true, data })
})

router.post('/import/run', upload.single('file'), async (req: Request, res: Response) => {
  const schema = z.object({
    source_id: z.string().min(1),
    entity: z.enum(['property', 'complex']),
    url: z.string().optional(),
    rows: z.string().optional()
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const runId = newId()
  const startedAt = new Date().toISOString()
  const run: {
    id: string
    source_id: string
    entity: 'property' | 'complex'
    started_at: string
    status: 'success' | 'failed' | 'partial'
    stats: { inserted: number; updated: number; hidden: number }
  } = {
    id: runId,
    source_id: parsed.data.source_id,
    entity: parsed.data.entity,
    started_at: startedAt,
    status: 'success',
    stats: { inserted: 0, updated: 0, hidden: 0 },
  }

  let errorLog = ''

  try {
    let rows: Record<string, unknown>[] = []
    
    if (parsed.data.rows) {
      try {
        rows = JSON.parse(parsed.data.rows)
        if (!Array.isArray(rows)) throw new Error('Rows must be an array')
      } catch (e) {
        throw new Error('Invalid rows JSON')
      }
    } else {
      const buffer = await getBuffer(req, parsed.data.url)
      const fileName = req.file?.originalname || parsed.data.url || 'feed'
      const ext = guessExt(fileName)
      rows = parseRows(buffer, ext)
    }

    const stats = withDb((db) => {
      const source = db.feed_sources.find(s => s.id === parsed.data.source_id)
      const mapping = source?.mapping

      if (parsed.data.entity === 'complex') {
        return upsertComplexes(db, parsed.data.source_id, rows, mapping)
      }
      
      // Auto-upsert complexes from properties to ensure linking works
      upsertComplexesFromProperties(db, parsed.data.source_id, rows, mapping)
      
      return upsertProperties(db, parsed.data.source_id, rows, mapping)
    })

    run.stats = { inserted: stats.inserted, updated: stats.updated, hidden: stats.hidden }

    if (stats.errors.length > 0) {
      run.status = stats.errors.length === rows.length ? 'failed' : 'partial'
      errorLog = `${stats.errors.length} строк с ошибками:\n` +
        stats.errors.slice(0, 50).map(e =>
          `Строка ${e.rowIndex}${e.externalId ? ` (${e.externalId})` : ''}: ${e.error}`
        ).join('\n')
    }
  } catch (e) {
    run.status = 'failed'
    errorLog = e instanceof Error ? e.message : 'Unknown error'
  } finally {
    withDb((db) => {
      db.import_runs.unshift({
        ...run,
        finished_at: new Date().toISOString(),
        error_log: errorLog || undefined,
      })
    })
  }

  if (run.status !== 'success') {
    res.status(500).json({ success: false, error: 'Import failed', details: errorLog })
    return
  }
  res.json({ success: true, data: run })
})

// Preview interfaces
interface PreviewRow {
  rowIndex: number
  data: Record<string, unknown>
  mappedFields: string[]
  errors: string[]
  warnings: string[]
}

interface PreviewResult {
  totalRows: number
  sampleRows: PreviewRow[]
  mappedItems: (Property | Complex)[]
  fieldMappings: Record<string, string[]>
  validRows: number
  invalidRows: number
}

// Helper function for field mapping tracking
function trackFieldMapping(
  mappings: Record<string, string[]>,
  field: string,
  row: Record<string, unknown>
) {
  if (!mappings[field]) mappings[field] = []
  const aliases: Record<string, string[]> = {
    external_id: ['external_id', 'id', 'externalId'],
    bedrooms: ['bedrooms', 'rooms'],
    area_total: ['area_total', 'area'],
    images: ['images', 'image_urls', 'photos'],
    complex_external_id: ['complex_external_id', 'complexExternalId', 'complex_id']
  }
  for (const alias of aliases[field] || []) {
    if (alias in row && !mappings[field].includes(alias)) {
      mappings[field].push(alias)
    }
  }
}

// Preview function for properties
function previewProperties(rows: Record<string, unknown>[]): PreviewResult {
  const sampleRows: PreviewRow[] = []
  const mappedItems: Property[] = []
  let validRows = 0
  let invalidRows = 0
  const fieldMappings: Record<string, string[]> = {}
  const previewCount = Math.min(100, rows.length)

  // Check all rows for validation stats
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const errors: string[] = []
    const warnings: string[] = []
    const mappedFields: string[] = []

    const externalId = asString(row.external_id || row.id || row.externalId)
    if (!externalId) {
      errors.push('Отсутствует external_id (или id/externalId)')
    } else {
      mappedFields.push('external_id')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'external_id', row)
    }

    const bedrooms = asNumber(row.bedrooms ?? row.rooms)
    if (typeof bedrooms !== 'number') {
      errors.push('Отсутствует или некорректное значение bedrooms (или rooms)')
    } else {
      mappedFields.push('bedrooms')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'bedrooms', row)
    }

    const price = asNumber(row.price)
    if (typeof price !== 'number') {
      errors.push('Отсутствует или некорректное значение price')
    } else {
      mappedFields.push('price')
    }

    const area = asNumber(row.area_total ?? row.area)
    if (typeof area !== 'number') {
      errors.push('Отсутствует или некорректное значение area_total (или area)')
    } else {
      mappedFields.push('area_total')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'area_total', row)
    }

    // District validation
    const district = asString(row.district)
    if (!district) {
      warnings.push('Отсутствует район (district) - фильтры по району работать не будут')
    } else {
      mappedFields.push('district')
    }

    // Category validation
    const category = asString(row.category)
    if (!category || !['newbuild', 'secondary', 'rent'].includes(category)) {
      warnings.push('Некорректная или отсутствующая категория (category) - по умолчанию будет newbuild')
    } else {
      mappedFields.push('category')
    }

    // Deal type validation
    const dealType = asString(row.deal_type)
    if (!dealType || !['sale', 'rent'].includes(dealType)) {
      warnings.push('Некорректный или отсутствующий тип сделки (deal_type) - по умолчанию будет sale')
    } else {
      mappedFields.push('deal_type')
    }

    // Metro (optional - not all feeds have it)
    if (row.metro && asString(row.metro)) {
      mappedFields.push('metro')
    }

    if (!row.title && !row.name) {
      warnings.push('Нет поля title/name - будет сгенерировано автоматически')
    } else {
      mappedFields.push('title')
    }

    if (!row.images && !row.image_urls && !row.photos && !row.image) {
      warnings.push('Изображения не предоставлены')
    } else {
      mappedFields.push('images')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'images', row)
    }

    // Only add first N rows to sample
    if (i < previewCount) {
      sampleRows.push({ rowIndex: i + 1, data: row, mappedFields, errors, warnings })
      mappedItems.push(mapRowToProperty(row))
    }

    // Count all rows for stats
    if (errors.length === 0) validRows++
    else invalidRows++
  }

  return {
    totalRows: rows.length,
    sampleRows,
    mappedItems,
    fieldMappings,
    validRows,
    invalidRows
  }
}

// Preview function for complexes
function previewComplexes(rows: Record<string, unknown>[], mapping?: Record<string, string>): PreviewResult {
  const sampleRows: PreviewRow[] = []
  let validRows = 0
  let invalidRows = 0
  const fieldMappings: Record<string, string[]> = {}
  const previewCount = Math.min(100, rows.length)

  // Check all rows for validation stats
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const errors: string[] = []
    const warnings: string[] = []
    const mappedFields: string[] = []

    const externalId = asString(row.external_id || row.id || row.externalId)
    if (!externalId) {
      errors.push('Отсутствует external_id (или id/externalId)')
    } else {
      mappedFields.push('external_id')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'external_id', row)
    }

    if (!row.title && !row.name) {
      warnings.push('Нет поля title/name - будет использован external_id')
    }

    if (!row.images && !row.image_urls && !row.photos) {
      warnings.push('Изображения не предоставлены')
    } else {
      mappedFields.push('images')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'images', row)
    }

    // Only add first N rows to sample
    if (i < previewCount) {
      sampleRows.push({ rowIndex: i + 1, data: row, mappedFields, errors, warnings })
    }

    // Count all rows for stats
    if (errors.length === 0) validRows++
    else invalidRows++
  }

  // Aggregate complexes for preview
  const aggregated = aggregateComplexesFromRows(rows, 'preview', mapping)
  const mappedItems: Complex[] = aggregated.slice(0, 100).map(c => ({
    ...c,
    id: c.external_id // Temporary ID for preview
  }))

  return {
    totalRows: rows.length,
    sampleRows,
    mappedItems,
    fieldMappings,
    validRows,
    invalidRows
  }
}

// Preview endpoint
router.post('/import/preview', upload.single('file'), async (req: Request, res: Response) => {
  const schema = z.object({
    source_id: z.string().min(1),
    entity: z.enum(['property', 'complex']),
    url: z.string().optional()
  })
  const parsed = schema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  try {
    const buffer = await getBuffer(req, parsed.data.url)
    const fileName = req.file?.originalname || parsed.data.url || 'feed'
    const ext = guessExt(fileName)
    const rows = parseRows(buffer, ext)

    const source = withDb((db) => db.feed_sources.find(s => s.id === parsed.data.source_id))
    const mapping = source?.mapping

    const preview = parsed.data.entity === 'complex'
      ? previewComplexes(rows, mapping)
      : previewProperties(rows)

    res.json({ success: true, data: preview })
  } catch (e) {
    res.status(500).json({
      success: false,
      error: 'Preview failed',
      details: e instanceof Error ? e.message : 'Unknown error'
    })
  }
})

function guessExt(name: string): 'csv' | 'xlsx' | 'xml' | 'json' {
  const lc = name.toLowerCase()
  if (lc.endsWith('.csv')) return 'csv'
  if (lc.endsWith('.xlsx') || lc.endsWith('.xls')) return 'xlsx'
  if (lc.endsWith('.xml')) return 'xml'
  return 'json'
}

async function getBuffer(req: Request, url?: string): Promise<Buffer> {
  if (req.file?.buffer) return req.file.buffer
  if (url) {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`)
    const ab = await r.arrayBuffer()
    return Buffer.from(ab)
  }
  throw new Error('No file provided')
}

function parseRows(buffer: Buffer, ext: 'csv' | 'xlsx' | 'xml' | 'json'): Record<string, unknown>[] {
  if (ext === 'csv') {
    const raw = buffer.toString('utf-8')
    return parseCsv(raw, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]
  }
  if (ext === 'xlsx') {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    const sheet = wb.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    return json as Record<string, unknown>[]
  }
  if (ext === 'xml') {
    const parser = new XMLParser({ ignoreAttributes: false })
    const obj = parser.parse(buffer.toString('utf-8'))
    const arr = findFirstArray(obj)
    const rows = (arr || []) as Record<string, unknown>[]
    // Normalize Yandex Realty XML format
    return rows.map(row => normalizeYandexRealty(row))
  }

  const obj = JSON.parse(buffer.toString('utf-8'))
  if (Array.isArray(obj)) return obj as Record<string, unknown>[]
  const arr = findFirstArray(obj)
  return (arr || []) as Record<string, unknown>[]
}

function findFirstArray(obj: unknown): unknown[] | null {
  if (!obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) return obj
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = findFirstArray(v)
    if (found) return found
  }
  return null
}

export default router
