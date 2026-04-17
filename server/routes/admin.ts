import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { adminAuth } from '../middleware/adminAuth.js'
import { withDb, withDbRead } from '../lib/storage.js'
import { newId, slugify } from '../lib/ids.js'
import type { Category, Complex, DbShape, Property } from '../../shared/types.js'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { UPLOADS_DIR } from '../lib/paths.js'
import { assertFeedRowLimit, fetchFeedBuffer } from '../lib/feed-fetch.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
const importLocks = new Map<string, number>()
const IMPORT_LOCK_STALE_MS = 4 * 60 * 60 * 1000
const LOCAL_TRENDAGENT_FEED_FILE = path.join(UPLOADS_DIR, 'trendagent-local-feed.json')

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
      status: 'visible',
      mode: 'manual',
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
  let validRows = 0
  let invalidRows = 0
  const fieldMappings: Record<string, string[]> = {}
  const previewCount = Math.min(20, rows.length)

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
    }

    // Count all rows for stats
    if (errors.length === 0) validRows++
    else invalidRows++
  }

  return {
    totalRows: rows.length,
    sampleRows,
    fieldMappings,
    validRows,
    invalidRows
  }
}

// Preview function for complexes
function previewComplexes(rows: Record<string, unknown>[]): PreviewResult {
  const sampleRows: PreviewRow[] = []
  let validRows = 0
  let invalidRows = 0
  const fieldMappings: Record<string, string[]> = {}
  const previewCount = Math.min(20, rows.length)

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

  return {
    totalRows: rows.length,
    sampleRows,
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

    const preview = parsed.data.entity === 'complex'
      ? previewComplexes(rows)
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

function normalizeYandexRealty(row: Record<string, unknown>): Record<string, unknown> {
  // Yandex Realty XML format normalization
  const normalized: Record<string, unknown> = {}

  // Internal ID from attribute
  normalized.external_id = asString(row['@_internal-id'] || row.internal_id || row.id)
  normalized.crm_id = row.crm_id

  // Deal type from <type>продажа</type>
  const type = asString(row.type)
  normalized.deal_type = type === 'аренда' || type === 'rent' ? 'rent' : 'sale'

  // Rooms -> bedrooms
  normalized.bedrooms = asNumber(row.rooms)

  // Nested price: <price><value>27490000</value></price>
  if (row.price && typeof row.price === 'object' && 'value' in row.price) {
    normalized.price = asNumber((row.price as Record<string, unknown>).value)
  } else {
    normalized.price = asNumber(row.price)
  }

  // Nested area: <area><value>59.5</value></area>
  if (row.area && typeof row.area === 'object' && 'value' in row.area) {
    normalized.area_total = asNumber((row.area as Record<string, unknown>).value)
  } else {
    normalized.area_total = asNumber(row.area)
  }

  // Location: <location><address>...</address><metro>...</metro></location>
  if (row.location && typeof row.location === 'object') {
    const loc = row.location as Record<string, unknown>

    // District from address (temporary - will be mapped to reference list later)
    normalized.district = asString(loc.address || loc['locality-name'])

    // Metro: extract from <metro><name>...</name></metro> if present
    const metros: string[] = []
    if (loc.metro) {
      if (Array.isArray(loc.metro)) {
        for (const m of loc.metro) {
          if (typeof m === 'object' && m && 'name' in m) {
            metros.push(asString((m as Record<string, unknown>).name))
          } else if (typeof m === 'string') {
            metros.push(m)
          }
        }
      } else if (typeof loc.metro === 'object' && 'name' in loc.metro) {
        metros.push(asString((loc.metro as Record<string, unknown>).name))
      } else if (typeof loc.metro === 'string') {
        metros.push(loc.metro)
      }
    }
    normalized.metro = metros.filter(Boolean).join(',')
  } else {
    normalized.district = ''
    normalized.metro = ''
  }

  // Building name -> complex_external_id
  const buildingName = asString(row['building-name'] || row.building_name)
  if (buildingName) {
    normalized.complex_external_id = buildingName
  }

  // Images: extract all <image> tags (usually floor plans, not photos)
  const images: string[] = []
  if (Array.isArray(row.image)) {
    for (const img of row.image) {
      if (typeof img === 'string') images.push(img)
      else if (img && typeof img === 'object' && '#text' in img) images.push(asString((img as Record<string, unknown>)['#text']))
      else if (img && typeof img === 'object' && 'url' in img) images.push(asString((img as Record<string, unknown>).url))
    }
  } else if (row.image) {
    if (typeof row.image === 'string') images.push(row.image)
    else if (typeof row.image === 'object' && '#text' in row.image) images.push(asString((row.image as Record<string, unknown>)['#text']))
  }
  normalized.images = images.filter(Boolean).join(',')

  // Category: determine by deal type and property status
  const dealStatus = asString(row['deal-status'] || row.deal_status)
  const newFlat = asString(row['new-flat'] || row.new_flat)
  const dealType = asString(normalized.deal_type)

  if (dealType === 'rent') {
    normalized.category = 'rent'
  } else if (newFlat === '1' || dealStatus.includes('первичн')) {
    normalized.category = 'newbuild'
  } else {
    normalized.category = 'secondary'
  }

  // Title: generate from rooms + building
  const rooms = asNumber(row.rooms)
  const roomsStr = rooms ? `${rooms}-комнатная` : 'квартира'
  normalized.title = buildingName ? `${roomsStr} в ${buildingName}` : roomsStr

  // Description
  normalized.description = asString(row.description)

  // Additional fields for potential use
  normalized.floor = asNumber(row.floor)
  normalized.floors_total = asNumber(row['floors-total'] || row.floors_total)
  normalized.renovation = asString(row.renovation)

  return normalized
}

function upsertComplexes(db: DbShape, sourceId: string, rows: Record<string, unknown>[]) {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  const index = new Map(db.complexes.filter((c) => c.source_id === sourceId).map((c) => [c.external_id, c]))
  let inserted = 0
  let updated = 0
  const errors: Array<{ rowIndex: number; externalId?: string; error: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const externalId = asString(row.external_id || row.id || row.externalId)
      if (!externalId) {
        errors.push({ rowIndex: i + 1, error: 'Отсутствует external_id' })
        continue
      }
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
    } catch (e) {
      errors.push({
        rowIndex: i + 1,
        externalId: asString(row.external_id || row.id),
        error: e instanceof Error ? e.message : 'Неизвестная ошибка'
      })
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

  return { inserted, updated, hidden, errors }
}

function upsertProperties(db: DbShape, sourceId: string, rows: Record<string, unknown>[]) {
  const now = new Date().toISOString()
  const seen = new Set<string>()
  const index = new Map(db.properties.filter((p) => p.source_id === sourceId).map((p) => [p.external_id, p]))
  const complexByExternal = new Map(db.complexes.filter((c) => c.source_id === sourceId).map((c) => [c.external_id, c]))
  let inserted = 0
  let updated = 0
  const errors: Array<{ rowIndex: number; externalId?: string; error: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const externalId = asString(row.external_id || row.id || row.externalId)
      if (!externalId) {
        errors.push({ rowIndex: i + 1, error: 'Отсутствует external_id' })
        continue
      }
      seen.add(externalId)

      const title = asString(row.title || row.name)
      const complexExternal = asString(row.complex_external_id ?? row.complexExternalId ?? row.complex_id)
      const complexId = complexExternal ? complexByExternal.get(complexExternal)?.id : undefined
      const cat = normalizeCategory(row.category)
      const dealType = normalizeDealType(row.deal_type ?? row.dealType)

      const bedrooms = asNumber(row.bedrooms ?? row.rooms)
      const price = asNumber(row.price)
      const area = asNumber(row.area_total ?? row.area)
      if (typeof bedrooms !== 'number' || typeof price !== 'number' || typeof area !== 'number') {
        errors.push({
          rowIndex: i + 1,
          externalId,
          error: `Некорректные данные - bedrooms: ${bedrooms}, price: ${price}, area: ${area}`
        })
        continue
      }

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
    } catch (e) {
      errors.push({
        rowIndex: i + 1,
        externalId: asString(row.external_id || row.id),
        error: e instanceof Error ? e.message : 'Неизвестная ошибка'
      })
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
  return { inserted, updated, hidden, errors }
}

type TrendAgentLocalFeedPayload = {
  aboutUrl: string
  downloadedAt: string
  sourceUrl: string
  fileMap: Record<string, string>
  stats: Record<string, number>
  data: Record<string, Record<string, unknown>[]>
}

type LocalFeedDownloadState = {
  status: 'idle' | 'downloading' | 'failed'
  startedAt?: string
  aboutUrl?: string
  progress: Record<string, number>
  currentFile?: string
  error?: string
}

let localFeedDownloadState: LocalFeedDownloadState = {
  status: 'idle',
  progress: {},
}

router.post('/import/trendagent/download-local', async (req: Request, res: Response) => {
  const schema = z.object({
    about_url: z.string().min(1),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  if (localFeedDownloadState.status === 'downloading') {
    res.status(409).json({ success: false, error: 'Local feed download is already running' })
    return
  }

  try {
    const aboutUrl = normalizeTrendAgentAboutUrlLocal(parsed.data.about_url.trim())
    startLocalTrendAgentDownload(aboutUrl)
    res.json({
      success: true,
      data: {
        queued: true,
        aboutUrl,
      },
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown error'
    res.status(400).json({ success: false, error: 'Unable to start download', details })
  }
})

router.get('/import/trendagent/local-feed', async (_req: Request, res: Response) => {
  if (localFeedDownloadState.status === 'downloading') {
    res.json({
      success: true,
      data: {
        downloading: true,
        startedAt: localFeedDownloadState.startedAt,
        aboutUrl: localFeedDownloadState.aboutUrl,
        progress: localFeedDownloadState.progress,
        currentFile: localFeedDownloadState.currentFile,
      },
    })
    return
  }

  if (localFeedDownloadState.status === 'failed') {
    res.json({
      success: true,
      data: {
        failed: true,
        error: localFeedDownloadState.error || 'Local feed download failed',
      },
    })
    return
  }

  try {
    const payload = await readLocalTrendAgentFeed()
    if (!payload) {
      res.json({ success: true, data: null })
      return
    }

    const totalRows = Object.values(payload.stats || {}).reduce((sum, n) => sum + (Number.isFinite(n) ? Number(n) : 0), 0)
    res.json({
      success: true,
      data: {
        downloadedAt: payload.downloadedAt,
        aboutUrl: payload.aboutUrl,
        stats: payload.stats,
        totalRows,
        file: path.basename(LOCAL_TRENDAGENT_FEED_FILE),
      },
    })
  } catch {
    res.json({ success: true, data: null })
  }
})

router.delete('/import/trendagent/local-feed', async (_req: Request, res: Response) => {
  if (localFeedDownloadState.status === 'downloading') {
    res.status(409).json({ success: false, error: 'Cannot delete local feed while download is in progress' })
    return
  }

  try {
    if (fs.existsSync(LOCAL_TRENDAGENT_FEED_FILE)) {
      await fs.promises.unlink(LOCAL_TRENDAGENT_FEED_FILE)
    }
    localFeedDownloadState = { status: 'idle', progress: {} }
    res.json({ success: true })
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: 'Failed to delete local feed', details })
  }
})

router.post('/import/trendagent/run-local', async (req: Request, res: Response) => {
  const schema = z.object({
    source_id: z.string().min(1),
    full_city: z.coerce.boolean().optional(),
    block_ids: z.array(z.string().min(1)).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  if (parsed.data.full_city !== true) {
    res.status(400).json({ success: false, error: 'Only full_city=true is supported for local TrendAgent import' })
    return
  }

  const payload = await readLocalTrendAgentFeed()
  if (!payload) {
    res.status(400).json({ success: false, error: 'Local feed not found. Download it first.' })
    return
  }

  const sourceSnapshot = withDbRead((db) => db.feed_sources.find((s) => s.id === parsed.data.source_id))
  if (!sourceSnapshot) {
    res.status(404).json({ success: false, error: 'Source not found' })
    return
  }

  const lockKey = `${parsed.data.source_id}:trendagent-local`
  if (hasActiveImportLock(lockKey)) {
    res.status(409).json({ success: false, error: 'Import already running for this source' })
    return
  }
  importLocks.set(lockKey, Date.now())

  const runId = newId()
  const startedAt = new Date().toISOString()
  withDb((db) => {
    ;(db.import_runs as unknown as Array<Record<string, unknown>>).unshift({
      id: runId,
      source_id: parsed.data.source_id,
      entity: 'property',
      started_at: startedAt,
      status: 'success',
      stats: { inserted: 0, updated: 0, hidden: 0 },
      action: 'import',
      feed_name: sourceSnapshot.name,
      feed_url: sourceSnapshot.url,
    })
  })

  const runLocalAsync = async (): Promise<void> => {
    let runStatus: 'success' | 'failed' | 'partial' = 'success'
    let errorLog = ''
    let stats = { inserted: 0, updated: 0, hidden: 0 }
    let targetComplexId: string | undefined

    try {
      const blocks = ensureObjectArrayLocal(payload.data?.blocks)
      const apartments = ensureObjectArrayLocal(payload.data?.apartments)
      if (blocks.length === 0) throw new Error('Local feed has no blocks')

      const fullCity = true
      const selectedBlockIds = new Set(blocks.map((b) => stringValueLocal(b._id || b.id)).filter(Boolean))

      if (selectedBlockIds.size === 0) throw new Error('No block IDs selected for import')

      const complexRows = buildTrendAgentComplexRowsLocal(blocks, apartments, selectedBlockIds, payload.sourceUrl || payload.aboutUrl)
      const propertyRows = buildTrendAgentPropertyRowsLocal(apartments, selectedBlockIds, payload.sourceUrl || payload.aboutUrl)
      if (propertyRows.length === 0) {
        throw new Error('No apartments found for selected complexes')
      }

      assertFeedRowLimit(propertyRows.length, fullCity)
      importLocks.set(lockKey, Date.now())

      const upsertResult = withDb((db) => {
        const complexStats = upsertComplexes(db, parsed.data.source_id, complexRows)
        const propertyStats = upsertProperties(db, parsed.data.source_id, propertyRows)
        const target = db.complexes.find(
          (item) => item.source_id === parsed.data.source_id && selectedBlockIds.has(item.external_id),
        )?.id
        return { complexStats, propertyStats, target }
      })

      stats = {
        inserted: upsertResult.propertyStats.inserted,
        updated: upsertResult.propertyStats.updated,
        hidden: upsertResult.propertyStats.hidden,
      }
      targetComplexId = upsertResult.target

      const allErrors = [...upsertResult.complexStats.errors, ...upsertResult.propertyStats.errors]
      if (allErrors.length > 0) {
        runStatus = 'partial'
        errorLog = `${allErrors.length} rows with errors:\n` + allErrors
          .slice(0, 50)
          .map((item) => `Row ${item.rowIndex}${item.externalId ? ` (${item.externalId})` : ''}: ${item.error}`)
          .join('\n')
      }
    } catch (error) {
      runStatus = 'failed'
      errorLog = error instanceof Error ? error.message : 'Unknown import error'
    } finally {
      importLocks.delete(lockKey)
      withDb((db) => {
        const run = (db.import_runs as unknown as Array<Record<string, unknown>>).find((item) => item.id === runId)
        if (!run) return
        run.status = runStatus
        run.stats = stats
        run.finished_at = new Date().toISOString()
        run.error_log = errorLog || undefined
        if (targetComplexId) run.target_complex_id = targetComplexId
      })
    }
  }

  void runLocalAsync()
  res.status(202).json({
    success: true,
    data: {
      queued: true,
      run_id: runId,
      source_id: parsed.data.source_id,
      message: 'Import from local feed started in background',
    },
  })
})

function hasActiveImportLock(lockKey: string): boolean {
  const startedAt = importLocks.get(lockKey)
  if (!startedAt) return false
  if (Date.now() - startedAt > IMPORT_LOCK_STALE_MS) {
    importLocks.delete(lockKey)
    return false
  }
  return true
}

function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function getTrendAgentFetchOptionsLocal(url: string): { timeoutMs: number; maxBytes: number } {
  const isApartments = /\/apartments\.json(?:\?|$)/i.test(url)
  const defaultTimeoutMs = isApartments ? 180_000 : 120_000
  const defaultMaxBytes = isApartments ? 600 * 1024 * 1024 : 250 * 1024 * 1024
  const timeoutMs = parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_TIMEOUT_MS) ?? defaultTimeoutMs
  const maxBytes = parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_MAX_BYTES) ?? defaultMaxBytes
  return { timeoutMs, maxBytes }
}

function isPlainObjectLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValueLocal(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function numberValueLocal(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function booleanValueLocal(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined
  const normalized = stringValueLocal(value).toLowerCase()
  if (!normalized) return undefined
  if (['1', 'true', 'yes', 'on', 'да'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off', 'нет'].includes(normalized)) return false
  return undefined
}

function compactAddressLocal(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const rec = isPlainObjectLocal(value) ? value : null
  if (!rec) return ''
  const parts = ['street', 'house', 'housing', 'building']
    .map((key) => stringValueLocal(rec[key]))
    .filter(Boolean)
  return parts.join(', ')
}

function normalizeTrendAgentAboutUrlLocal(sourceUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  const pathname = parsed.pathname || '/'
  if (pathname.endsWith('/about.json') || pathname.endsWith('about.json')) {
    return parsed.toString()
  }
  if (/\.[a-z0-9]+$/i.test(pathname) && !/\.json$/i.test(pathname)) {
    throw new Error('Source URL must point to about.json or a directory')
  }
  if (pathname.endsWith('.json')) return parsed.toString()

  parsed.pathname = pathname.endsWith('/') ? `${pathname}about.json` : `${pathname}/about.json`
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function toAbsoluteUrlLocal(baseUrl: string, relativeOrAbsolute: string): string {
  return new URL(relativeOrAbsolute, baseUrl).toString()
}

function findFirstObjectArrayLocal(obj: unknown): Record<string, unknown>[] | null {
  if (!obj || typeof obj !== 'object') return null
  if (Array.isArray(obj) && (obj.length === 0 || obj.every(isPlainObjectLocal))) {
    return obj as Record<string, unknown>[]
  }
  for (const value of Object.values(obj as Record<string, unknown>)) {
    const found = findFirstObjectArrayLocal(value)
    if (found) return found
  }
  return null
}

function ensureObjectArrayLocal(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isPlainObjectLocal) as Record<string, unknown>[]
  const found = findFirstObjectArrayLocal(value)
  return found || []
}

async function fetchJsonValueLocal(url: string): Promise<unknown> {
  const options = getTrendAgentFetchOptionsLocal(url)
  const buffer = await fetchFeedBuffer(url, options)
  return JSON.parse(buffer.toString('utf-8'))
}

function extractTrendAgentFileMapLocal(aboutUrl: string, aboutPayload: unknown): Record<string, string> {
  const map: Record<string, string> = {}

  const assignEntry = (entry: unknown): void => {
    const rec = isPlainObjectLocal(entry) ? entry : null
    if (!rec) return
    const name = stringValueLocal(rec.name).toLowerCase()
    const fileUrl = stringValueLocal(rec.url)
    if (!name || !fileUrl) return
    map[name] = toAbsoluteUrlLocal(aboutUrl, fileUrl)
  }

  if (Array.isArray(aboutPayload)) {
    for (const entry of aboutPayload) assignEntry(entry)
  } else {
    const rec = isPlainObjectLocal(aboutPayload) ? aboutPayload : null
    if (rec) {
      const nested = findFirstObjectArrayLocal(rec)
      if (nested) {
        for (const entry of nested) assignEntry(entry)
      }
      for (const [key, value] of Object.entries(rec)) {
        if (typeof value !== 'string') continue
        const normalizedKey = key.toLowerCase()
        if (normalizedKey.endsWith('.json') || value.toLowerCase().endsWith('.json')) {
          map[normalizedKey.replace(/\.json$/i, '')] = toAbsoluteUrlLocal(aboutUrl, value)
        }
      }
    }
  }

  return map
}

function normalizeTrendAgentImageUrlLocal(value: unknown, baseUrl: string): string | null {
  const raw = stringValueLocal(value)
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`

  let cleaned = raw
  while (cleaned.startsWith('../')) cleaned = cleaned.slice(3)
  while (cleaned.startsWith('./')) cleaned = cleaned.slice(2)
  try {
    return new URL(cleaned, baseUrl).toString()
  } catch {
    return null
  }
}

function collectTrendAgentImageUrlsLocal(value: unknown, baseUrl: string, out: Set<string>): void {
  if (!value) return
  if (Array.isArray(value)) {
    for (const item of value) collectTrendAgentImageUrlsLocal(item, baseUrl, out)
    return
  }
  const rec = isPlainObjectLocal(value) ? value : null
  if (rec) {
    if (rec.url) collectTrendAgentImageUrlsLocal(rec.url, baseUrl, out)
    if (rec.src) collectTrendAgentImageUrlsLocal(rec.src, baseUrl, out)
    if (rec.path) collectTrendAgentImageUrlsLocal(rec.path, baseUrl, out)
    return
  }

  const normalized = normalizeTrendAgentImageUrlLocal(value, baseUrl)
  if (normalized) out.add(normalized)
}

function collectTrendAgentSubwayNamesLocal(value: unknown): string[] {
  const names = new Set<string>()

  const visit = (node: unknown): void => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (isPlainObjectLocal(node)) {
      const name = stringValueLocal(node.name || node.subway_name || node.title || node.subway_id || node.id)
      if (name) names.add(name)
      return
    }
    const raw = stringValueLocal(node)
    if (raw) names.add(raw)
  }

  visit(value)
  return [...names]
}

function parseTrendAgentBedroomsLocal(roomCode: unknown, roomName: string): { bedrooms: number; isEuroflat: boolean } {
  const code = numberValueLocal(roomCode)
  if (typeof code === 'number') {
    const euroMap: Record<number, number> = { 22: 2, 23: 3, 24: 4, 25: 5 }
    const mapped = euroMap[Math.trunc(code)]
    if (mapped) return { bedrooms: mapped, isEuroflat: true }
  }
  const normalized = roomName.toLowerCase()
  const match = normalized.match(/(\d+)/)
  const bedrooms = match ? Math.max(0, Number(match[1])) : 1
  return { bedrooms, isEuroflat: /[еe]/i.test(normalized) }
}

function extractGeometryPointLocal(value: unknown): { lat?: number; lon?: number } {
  const rec = isPlainObjectLocal(value) ? value : null
  if (!rec) return {}
  const geometry = isPlainObjectLocal(rec.geometry) ? rec.geometry : rec
  const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : []
  if (coords.length >= 2) {
    const lon = numberValueLocal(coords[0])
    const lat = numberValueLocal(coords[1])
    if (typeof lat === 'number' && typeof lon === 'number') {
      return { lat, lon }
    }
  }
  return {}
}

function buildTrendAgentComplexRowsLocal(
  blocks: Record<string, unknown>[],
  apartments: Record<string, unknown>[],
  selectedBlockIds: Set<string>,
  baseUrl: string,
): Record<string, unknown>[] {
  const statsByBlock = new Map<string, { count: number; minPrice?: number; minArea?: number; district?: string; title?: string; metro: Set<string>; developer?: string }>()

  for (const apt of apartments) {
    const blockId = stringValueLocal(apt.block_id)
    if (!blockId || !selectedBlockIds.has(blockId)) continue
    const bucket = statsByBlock.get(blockId) || { count: 0, metro: new Set<string>() }
    bucket.count += 1

    const price = numberValueLocal(apt.price)
    if (typeof price === 'number') {
      bucket.minPrice = typeof bucket.minPrice === 'number' ? Math.min(bucket.minPrice, price) : price
    }

    const area = numberValueLocal(apt.area_total)
    if (typeof area === 'number') {
      bucket.minArea = typeof bucket.minArea === 'number' ? Math.min(bucket.minArea, area) : area
    }

    const district = stringValueLocal(apt.block_district_name)
    if (district && !bucket.district) bucket.district = district
    const title = stringValueLocal(apt.block_name)
    if (title && !bucket.title) bucket.title = title
    const developer = stringValueLocal(apt.block_builder_name)
    if (developer && !bucket.developer) bucket.developer = developer
    for (const metro of collectTrendAgentSubwayNamesLocal(apt.block_subway_name)) {
      if (metro) bucket.metro.add(metro)
    }

    statsByBlock.set(blockId, bucket)
  }

  const rows: Record<string, unknown>[] = []
  for (const block of blocks) {
    const blockId = stringValueLocal(block._id || block.id)
    if (!blockId || !selectedBlockIds.has(blockId)) continue
    const stat = statsByBlock.get(blockId)

    const imageUrls = new Set<string>()
    collectTrendAgentImageUrlsLocal(block.renderer, baseUrl, imageUrls)
    collectTrendAgentImageUrlsLocal(block.plan, baseUrl, imageUrls)
    collectTrendAgentImageUrlsLocal(block.progress, baseUrl, imageUrls)

    const district = stringValueLocal(block.district_name || block.block_district_name || stat?.district || '')
    const metro = stat && stat.metro.size ? [...stat.metro] : collectTrendAgentSubwayNamesLocal(block.subway)
    const geo = extractGeometryPointLocal(block)

    rows.push({
      external_id: blockId,
      title: stringValueLocal(block.name || stat?.title || blockId),
      category: 'newbuild',
      district,
      metro,
      price_from: stat?.minPrice,
      area_from: stat?.minArea,
      images: [...imageUrls],
      status: 'active',
      developer: stringValueLocal(block.builder_name || block.block_builder_name || stat?.developer || ''),
      description: stringValueLocal(block.description || ''),
      address: compactAddressLocal(block.address),
      geo_lat: geo.lat,
      geo_lon: geo.lon,
    })
  }

  return rows
}

function buildTrendAgentPropertyRowsLocal(
  apartments: Record<string, unknown>[],
  selectedBlockIds: Set<string>,
  baseUrl: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  for (const apt of apartments) {
    const blockId = stringValueLocal(apt.block_id)
    if (!blockId || !selectedBlockIds.has(blockId)) continue
    const externalId = stringValueLocal(apt._id || apt.id)
    if (!externalId) continue

    const roomName = stringValueLocal(apt.room_name || apt.rooms_name || apt.room)
    const parsedBedrooms = parseTrendAgentBedroomsLocal(apt.room, roomName)
    const blockName = stringValueLocal(apt.block_name || blockId)
    const title = parsedBedrooms.bedrooms === 0
      ? `Studio in ${blockName}`
      : parsedBedrooms.isEuroflat
        ? `${parsedBedrooms.bedrooms}E in ${blockName}`
        : `${parsedBedrooms.bedrooms}-room in ${blockName}`

    const imageUrls = new Set<string>()
    collectTrendAgentImageUrlsLocal(apt.plan, baseUrl, imageUrls)
    collectTrendAgentImageUrlsLocal(apt.block_renderer, baseUrl, imageUrls)

    rows.push({
      external_id: externalId,
      complex_external_id: blockId,
      title,
      bedrooms: parsedBedrooms.bedrooms,
      is_euroflat: parsedBedrooms.isEuroflat,
      lot_number: stringValueLocal(apt.number),
      price: numberValueLocal(apt.price) ?? 0,
      old_price: numberValueLocal(apt.price_base),
      area_total: numberValueLocal(apt.area_total) ?? 0,
      area_living: numberValueLocal(apt.area_rooms_total),
      area_kitchen: numberValueLocal(apt.area_kitchen),
      floor: numberValueLocal(apt.floor),
      floors_total: numberValueLocal(apt.floors),
      district: stringValueLocal(apt.block_district_name),
      metro: collectTrendAgentSubwayNamesLocal(apt.block_subway_name),
      images: [...imageUrls],
      renovation: stringValueLocal(apt.finishing_name || apt.finishing),
      building_section: stringValueLocal(apt.building_name),
      building_queue: numberValueLocal(apt.building_queue),
      building_type: stringValueLocal(apt.building_type_name || apt.building_type),
      description: stringValueLocal(apt.block_description || apt.description),
      mortgage_available: booleanValueLocal(apt.building_mortgage ?? apt.mortgage),
      status: 'active',
      deal_type: 'sale',
      category: 'newbuild',
    })
  }

  return rows
}

async function startLocalTrendAgentDownload(aboutUrl: string): Promise<void> {
  localFeedDownloadState = {
    status: 'downloading',
    startedAt: new Date().toISOString(),
    aboutUrl,
    progress: {},
    currentFile: 'about.json',
  }

  const run = async (): Promise<void> => {
    try {
      const aboutPayload = await fetchJsonValueLocal(aboutUrl)
      const fileMap = extractTrendAgentFileMapLocal(aboutUrl, aboutPayload)
      if (!fileMap.apartments) throw new Error('about.json does not include apartments.json')
      if (!fileMap.blocks) throw new Error('about.json does not include blocks.json')

      const fileNames = ['apartments', 'blocks', 'buildings', 'builders', 'regions', 'subways', 'rooms', 'finishings', 'buildingtypes'] as const
      const downloadedData: Record<string, Record<string, unknown>[]> = {}
      const stats: Record<string, number> = {}

      for (const fileName of fileNames) {
        localFeedDownloadState.currentFile = `${fileName}.json`
        const url = fileMap[fileName]
        if (!url) {
          downloadedData[fileName] = []
          stats[fileName] = 0
          localFeedDownloadState.progress[fileName] = 0
          continue
        }
        const payload = await fetchJsonValueLocal(url)
        const rows = ensureObjectArrayLocal(payload)
        downloadedData[fileName] = rows
        stats[fileName] = rows.length
        localFeedDownloadState.progress[fileName] = rows.length
      }

      const localPayload: TrendAgentLocalFeedPayload = {
        aboutUrl,
        downloadedAt: new Date().toISOString(),
        sourceUrl: aboutUrl,
        fileMap,
        stats,
        data: downloadedData,
      }

      await fs.promises.mkdir(UPLOADS_DIR, { recursive: true })
      await fs.promises.writeFile(LOCAL_TRENDAGENT_FEED_FILE, JSON.stringify(localPayload), 'utf-8')

      localFeedDownloadState = {
        status: 'idle',
        progress: {},
      }
    } catch (error) {
      localFeedDownloadState = {
        status: 'failed',
        progress: {},
        aboutUrl,
        error: error instanceof Error ? error.message : 'Local feed download failed',
      }
    }
  }

  void run()
}

async function readLocalTrendAgentFeed(): Promise<TrendAgentLocalFeedPayload | null> {
  if (!fs.existsSync(LOCAL_TRENDAGENT_FEED_FILE)) return null
  const raw = await fs.promises.readFile(LOCAL_TRENDAGENT_FEED_FILE, 'utf-8')
  const payload = JSON.parse(raw) as TrendAgentLocalFeedPayload
  if (!payload || typeof payload !== 'object') return null
  return payload
}

export default router
