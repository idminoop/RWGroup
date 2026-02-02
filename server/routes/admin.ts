import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { adminAuth } from '../middleware/adminAuth.js'
import { withDb } from '../lib/storage.js'
import { newId, slugify } from '../lib/ids.js'
import type { Category, Complex, DbShape, Property } from '../../shared/types.js'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

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
  const schema = z.object({ name: z.string().min(1), mode: z.enum(['upload', 'url']), url: z.string().optional(), format: z.enum(['xlsx', 'csv', 'xml', 'json']) })
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
      created_at: new Date().toISOString(),
    })
  })
  res.json({ success: true, data: { id } })
})

router.put('/feeds/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const schema = z.object({ name: z.string().min(1).optional(), mode: z.enum(['upload', 'url']).optional(), url: z.string().optional(), format: z.enum(['xlsx', 'csv', 'xml', 'json']).optional(), is_active: z.boolean().optional() })
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
    return db.feed_sources.length !== before
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
  const schema = z.object({ title: z.string().min(1), description: z.string().optional(), cover_image: z.string().optional(), priority: z.number().int().optional() })
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
      items: [],
      updated_at: new Date().toISOString(),
    })
  })
  res.json({ success: true, data: { id } })
})

router.put('/collections/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const schema = z.object({ title: z.string().min(1).optional(), description: z.string().optional(), cover_image: z.string().optional(), priority: z.number().int().optional(), items: z.array(z.object({ type: z.enum(['property', 'complex']), ref_id: z.string().min(1) })).optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const ok = withDb((db) => {
    const col = db.collections.find((c) => c.id === id)
    if (!col) return false
    if (parsed.data.title) col.slug = slugify(parsed.data.title)
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

router.get('/import/runs', (req: Request, res: Response) => {
  const data = withDb((db) => db.import_runs.sort((a, b) => (b.started_at || '').localeCompare(a.started_at || '')))
  res.json({ success: true, data })
})

router.post('/import/run', upload.single('file'), async (req: Request, res: Response) => {
  const schema = z.object({ source_id: z.string().min(1), entity: z.enum(['property', 'complex']), url: z.string().optional() })
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
    const buffer = await getBuffer(req, parsed.data.url)
    const fileName = req.file?.originalname || parsed.data.url || 'feed'
    const ext = guessExt(fileName)
    const rows = parseRows(buffer, ext)

    const stats = withDb((db) => {
      if (parsed.data.entity === 'complex') {
        return upsertComplexes(db, parsed.data.source_id, rows)
      }
      return upsertProperties(db, parsed.data.source_id, rows)
    })

    run.stats = stats
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
    return (arr || []) as Record<string, unknown>[]
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

function asString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return ''
}

function asNumber(v: unknown): number | undefined {
  const n = Number(String(v).replace(/\s/g, '').replace(/,/g, '.'))
  return Number.isFinite(n) ? n : undefined
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).map((s) => s.trim()).filter(Boolean)
  const s = asString(v)
  if (!s) return []
  return s
    .split(/[,;|]/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

function normalizeStatus(v: unknown): 'active' | 'hidden' | 'archived' {
  const s = asString(v).toLowerCase().trim()
  if (s === 'hidden' || s === 'archived') return s
  return 'active'
}

function normalizeCategory(v: unknown): Category {
  const s = asString(v).toLowerCase().trim()
  if (s === 'secondary') return 'secondary'
  if (s === 'rent') return 'rent'
  return 'newbuild'
}

function normalizeDealType(v: unknown): 'sale' | 'rent' {
  const s = asString(v).toLowerCase().trim()
  return s === 'rent' ? 'rent' : 'sale'
}

function upsertComplexes(db: DbShape, sourceId: string, rows: Record<string, unknown>[]) {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  const index = new Map(db.complexes.filter((c) => c.source_id === sourceId).map((c) => [c.external_id, c]))
  let inserted = 0
  let updated = 0

  for (const row of rows) {
    const externalId = asString(row.external_id || row.id || row.externalId)
    if (!externalId) continue
    seen.add(externalId)
    const title = asString(row.title || row.name)
    const next: Omit<Complex, 'id'> = {
      source_id: sourceId,
      external_id: externalId,
      slug: slugify(title || externalId),
      title: title || externalId,
      category: 'newbuild',
      district: asString(row.district || row.area || row.region),
      metro: asStringArray(row.metro),
      price_from: asNumber(row.price_from ?? row.priceFrom ?? row.price_min),
      area_from: asNumber(row.area_from ?? row.areaFrom ?? row.area_min),
      images: asStringArray(row.images ?? row.image_urls ?? row.photos),
      status: normalizeStatus(row.status),
      developer: asString(row.developer),
      class: asString(row.class),
      finish_type: asString(row.finish_type ?? row.finishType),
      handover_date: asString(row.handover_date ?? row.handoverDate),
      geo_lat: asNumber(row.geo_lat ?? row.lat),
      geo_lon: asNumber(row.geo_lon ?? row.lon),
      last_seen_at: now,
      updated_at: now,
    }

    const existing = index.get(externalId)
    if (existing) {
      Object.assign(existing, next)
      updated += 1
    } else {
      db.complexes.unshift({ id: newId(), ...next })
      inserted += 1
    }
  }

  let hidden = 0
  for (const c of db.complexes) {
    if (c.source_id !== sourceId) continue
    if (!seen.has(c.external_id) && c.status === 'active') {
      c.status = 'hidden'
      c.updated_at = now
      hidden += 1
    }
  }

  return { inserted, updated, hidden }
}

function upsertProperties(db: DbShape, sourceId: string, rows: Record<string, unknown>[]) {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  const index = new Map(db.properties.filter((p) => p.source_id === sourceId).map((p) => [p.external_id, p]))
  const complexByExternal = new Map(db.complexes.filter((c) => c.source_id === sourceId).map((c) => [c.external_id, c]))
  let inserted = 0
  let updated = 0

  for (const row of rows) {
    const externalId = asString(row.external_id || row.id || row.externalId)
    if (!externalId) continue
    seen.add(externalId)

    const title = asString(row.title || row.name)
    const complexExternal = asString(row.complex_external_id ?? row.complexExternalId ?? row.complex_id)
    const complexId = complexExternal ? complexByExternal.get(complexExternal)?.id : undefined
    const cat = normalizeCategory(row.category)
    const dealType = normalizeDealType(row.deal_type ?? row.dealType)

    const bedrooms = asNumber(row.bedrooms ?? row.rooms)
    const price = asNumber(row.price)
    const area = asNumber(row.area_total ?? row.area)
    if (typeof bedrooms !== 'number' || typeof price !== 'number' || typeof area !== 'number') continue

    const next: Omit<Property, 'id'> = {
      source_id: sourceId,
      external_id: externalId,
      slug: slugify(title || externalId),
      lot_number: asString(row.lot_number ?? row.lotNumber),
      complex_id: complexId,
      complex_external_id: complexExternal || undefined,
      deal_type: dealType,
      category: cat,
      title: title || externalId,
      bedrooms,
      price,
      price_period: dealType === 'rent' ? 'month' : undefined,
      area_total: area,
      district: asString(row.district || row.area || row.region),
      metro: asStringArray(row.metro),
      images: asStringArray(row.images ?? row.image_urls ?? row.photos),
      status: normalizeStatus(row.status),
      last_seen_at: now,
      updated_at: now,
    }

    const existing = index.get(externalId)
    if (existing) {
      Object.assign(existing, next)
      updated += 1
    } else {
      db.properties.unshift({ id: newId(), ...next })
      inserted += 1
    }
  }

  let hidden = 0
  for (const p of db.properties) {
    if (p.source_id !== sourceId) continue
    if (!seen.has(p.external_id) && p.status === 'active') {
      p.status = 'hidden'
      p.updated_at = now
      hidden += 1
    }
  }
  return { inserted, updated, hidden }
}

export default router
