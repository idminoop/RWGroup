import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import {
  adminAuth,
  issueAdminToken,
  requireAdminAnyPermission,
  requireAdminPermission,
} from '../middleware/adminAuth.js'
import {
  getPublishStatus,
  publishDraft,
  readDb,
  readPublishedDb,
  withDb,
  withDbRead,
  writePublishedDb,
} from '../lib/storage.js'
import { newId, slugify } from '../lib/ids.js'
import { resolveCollectionItems } from '../lib/collections.js'
import {
  countActiveOwners,
  ensureAdminUsers,
  findAdminUserByLogin,
  hasAdminRole,
  hashAdminPassword,
  readAdminUsers,
  normalizeAdminLogin,
  normalizeAdminRoles,
  toAdminIdentity,
  toAdminUserPublic,
  verifyAdminPassword,
} from '../lib/admin-users.js'
import { addAuditLog, appendAuditLog } from '../lib/audit.js'
import { uploadImage } from '../lib/media-storage.js'
import {
  createManualBackup,
  deleteBackupById,
  listBackups,
  listLeadProcessingBackups,
  restoreBackupById,
  restoreLeadProcessingByBackupId,
} from '../lib/backups.js'
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
import { assertFeedRowLimit, fetchFeedBuffer } from '../lib/feed-fetch.js'
import type { AdminRole, AdminUser, Category, Complex, DbShape, LandingFeaturePreset, Lead, LeadStatus, Property } from '../../shared/types.js'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
const importLocks = new Map<string, number>()
const IMPORT_LOCK_STALE_MS = 4 * 60 * 60 * 1000
const DEFAULT_FEED_REFRESH_INTERVAL_HOURS = 24
const TRENDAGENT_CACHE_TTL_MS = 5 * 60 * 1000
const TRENDAGENT_DEFAULT_TIMEOUT_MS = 120_000
const TRENDAGENT_DEFAULT_MAX_BYTES = 250 * 1024 * 1024
const TRENDAGENT_APARTMENTS_TIMEOUT_MS = 180_000
const TRENDAGENT_APARTMENTS_MAX_BYTES = 600 * 1024 * 1024
const TRENDAGENT_FETCH_RETRIES_DEFAULT = 2
const TRENDAGENT_FETCH_RETRY_DELAY_MS_DEFAULT = 1200

type TrendAgentDataset = {
  sourceUrl: string
  aboutUrl: string
  files: Record<string, string>
  apartments: Record<string, unknown>[]
  blocks: Record<string, unknown>[]
  buildings: Record<string, unknown>[]
  builders: Record<string, unknown>[]
  regions: Record<string, unknown>[]
  subways: Record<string, unknown>[]
  rooms: Record<string, unknown>[]
  finishings: Record<string, unknown>[]
  buildingtypes: Record<string, unknown>[]
}

type TrendAgentComplexOption = {
  block_id: string
  title: string
  district?: string
  developer?: string
  address?: string
  lots_count: number
  price_from?: number
  price_to?: number
}

type TrendAgentDatasetMode = 'full' | 'list' | 'complex'

const trendAgentDatasetCache = new Map<string, { loadedAt: number; dataset: TrendAgentDataset }>()

function hasActiveImportLock(lockKey: string): boolean {
  const startedAt = importLocks.get(lockKey)
  if (!startedAt) return false
  if (Date.now() - startedAt > IMPORT_LOCK_STALE_MS) {
    importLocks.delete(lockKey)
    return false
  }
  return true
}

function toNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

type FeedRefreshInput = {
  mode: 'upload' | 'url'
  url?: string
  auto_refresh?: boolean
  refresh_interval_hours?: number
}

type FeedRefreshResult =
  | {
      ok: true
      value: {
        url?: string
        auto_refresh: boolean
        refresh_interval_hours?: number
      }
    }
  | { ok: false; error: string }

function normalizeFeedUrl(url?: string): string | undefined {
  const trimmed = typeof url === 'string' ? url.trim() : ''
  return trimmed || undefined
}

function resolveFeedRefreshSettings(input: FeedRefreshInput): FeedRefreshResult {
  if (input.mode === 'upload') {
    return {
      ok: true,
      value: {
        url: undefined,
        auto_refresh: false,
        refresh_interval_hours: undefined,
      },
    }
  }

  const url = normalizeFeedUrl(input.url)
  const autoRefresh = Boolean(input.auto_refresh)

  if (!autoRefresh) {
    return {
      ok: true,
      value: {
        url,
        auto_refresh: false,
        refresh_interval_hours: undefined,
      },
    }
  }

  if (!url) {
    return { ok: false, error: 'Р”Р»СЏ Р°РІС‚РѕРѕР±РЅРѕРІР»РµРЅРёСЏ СѓРєР°Р¶РёС‚Рµ URL С„РёРґР°' }
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'URL С„РёРґР° РґРѕР»Р¶РµРЅ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ http/https' }
    }
    if (parsed.username || parsed.password) {
      return { ok: false, error: 'URL С„РёРґР° РЅРµ РґРѕР»Р¶РµРЅ СЃРѕРґРµСЂР¶Р°С‚СЊ Р»РѕРіРёРЅ/РїР°СЂРѕР»СЊ' }
    }
  } catch {
    return { ok: false, error: 'РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ URL С„РёРґР°' }
  }

  const interval =
    typeof input.refresh_interval_hours === 'number'
      ? Math.max(1, Math.min(168, Math.floor(input.refresh_interval_hours)))
      : DEFAULT_FEED_REFRESH_INTERVAL_HOURS

  return {
    ok: true,
    value: {
      url,
      auto_refresh: true,
      refresh_interval_hours: interval,
    },
  }
}

function ensureCustomLandingFeaturePresets(db: DbShape): LandingFeaturePreset[] {
  if (!Array.isArray(db.landing_feature_presets)) {
    db.landing_feature_presets = []
  }
  return db.landing_feature_presets
}

function ensureHiddenPresetKeys(db: DbShape): string[] {
  if (!Array.isArray(db.hidden_landing_feature_preset_keys)) {
    db.hidden_landing_feature_preset_keys = []
  }
  return db.hidden_landing_feature_preset_keys
}

type CatalogCleanupStats = {
  collectionItemsRemoved: number
  collectionsTouched: number
  featuredRemoved: number
}

function cleanupCatalogReferences(
  db: DbShape,
  deletedPropertyIds: Set<string>,
  deletedComplexIds: Set<string>,
): CatalogCleanupStats {
  if (deletedPropertyIds.size === 0 && deletedComplexIds.size === 0) {
    return { collectionItemsRemoved: 0, collectionsTouched: 0, featuredRemoved: 0 }
  }

  const now = new Date().toISOString()
  let collectionItemsRemoved = 0
  let collectionsTouched = 0

  for (const collection of db.collections) {
    if (!Array.isArray(collection.items) || collection.items.length === 0) continue

    const before = collection.items.length
    collection.items = collection.items.filter((item) => {
      if (item.type === 'property') return !deletedPropertyIds.has(item.ref_id)
      if (item.type === 'complex') return !deletedComplexIds.has(item.ref_id)
      return true
    })

    const removed = before - collection.items.length
    if (removed > 0) {
      collectionItemsRemoved += removed
      collectionsTouched += 1
      collection.updated_at = now
    }
  }

  let featuredRemoved = 0
  const featured = db.home?.featured
  if (featured && typeof featured === 'object') {
    if (Array.isArray(featured.properties)) {
      const before = featured.properties.length
      featured.properties = featured.properties.filter((item) => !deletedPropertyIds.has(item))
      featuredRemoved += before - featured.properties.length
    }

    if (Array.isArray(featured.complexes)) {
      const before = featured.complexes.length
      featured.complexes = featured.complexes.filter((item) => !deletedComplexIds.has(item))
      featuredRemoved += before - featured.complexes.length
    }

    if (featuredRemoved > 0) {
      db.home.updated_at = now
    }
  }

  return { collectionItemsRemoved, collectionsTouched, featuredRemoved }
}

function toCustomLandingFeatureKey(value: string): string {
  return slugify(value)
    .replace(/-/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '')
}

function resolveRolesInput(input: { roles?: AdminRole[]; role?: AdminRole }): AdminRole[] {
  return normalizeAdminRoles(input.roles ?? input.role)
}

router.post('/login', (req: Request, res: Response) => {
  const schema = z.object({
    login: z.string().min(1),
    password: z.string().min(1),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const login = normalizeAdminLogin(parsed.data.login)
  const identity = withDb((db) => {
    const users = ensureAdminUsers(db)
    const user = findAdminUserByLogin(users, login)
    if (!user || !user.is_active) return null
    if (!verifyAdminPassword(parsed.data.password, user.password_hash)) return null
    return toAdminIdentity(user)
  })

  if (!identity) {
    res.status(401).json({ success: false, error: 'Invalid credentials' })
    return
  }

  const token = issueAdminToken(identity)
  addAuditLog(identity.id, identity.login, 'login', 'user', identity.id, `Р’С…РѕРґ РІ СЃРёСЃС‚РµРјСѓ: ${identity.login}`)
  res.json({
    success: true,
    data: {
      token,
      id: identity.id,
      login: identity.login,
      roles: identity.roles,
      permissions: identity.permissions,
    },
  })
})

router.use(adminAuth)

router.get('/me', (req: Request, res: Response) => {
  if (!req.admin) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return
  }
  res.json({ success: true, data: req.admin })
})

router.get('/users', requireAdminPermission('admin_users.read'), (req: Request, res: Response) => {
  const data = withDbRead((db) => {
    const users = readAdminUsers(db)
    return users
      .map(toAdminUserPublic)
      .sort((a, b) => a.login.localeCompare(b.login))
  })
  res.json({ success: true, data })
})

router.post('/users', requireAdminPermission('admin_users.write'), (req: Request, res: Response) => {
  const roleSchema = z.enum(['owner', 'content', 'import', 'sales'])
  const schema = z.object({
    login: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
    password: z.string().min(1).max(256),
    roles: z.array(roleSchema).min(1).optional(),
    role: roleSchema.optional(),
    is_active: z.boolean().optional(),
  }).refine((payload) => (payload.roles && payload.roles.length > 0) || payload.role !== undefined, {
    message: 'Roles are required',
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const roles = resolveRolesInput(parsed.data)
  if (!roles.length) {
    res.status(400).json({ success: false, error: 'Roles are required' })
    return
  }

  const login = normalizeAdminLogin(parsed.data.login)
  let created: AdminUser | null = null
  const result = withDb((db) => {
    const users = ensureAdminUsers(db)
    const duplicate = findAdminUserByLogin(users, login)
    if (duplicate) return { ok: false as const, error: 'Login already exists' }

    const now = new Date().toISOString()
    const next: AdminUser = {
      id: newId(),
      login,
      password_hash: hashAdminPassword(parsed.data.password),
      roles,
      is_active: parsed.data.is_active ?? true,
      created_at: now,
      updated_at: now,
    }
    users.push(next)
    created = next
    return { ok: true as const }
  })

  if (!result.ok || !created) {
    res.status(409).json({ success: false, error: result.error || 'Login already exists' })
    return
  }

  addAuditLog(req.admin!.id, req.admin!.login, 'create', 'user', created.id, `РЎРѕР·РґР°РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ: ${created.login}`)
  res.json({ success: true, data: toAdminUserPublic(created) })
})

router.put('/users/:id', requireAdminPermission('admin_users.write'), (req: Request, res: Response) => {
  const roleSchema = z.enum(['owner', 'content', 'import', 'sales'])
  const schema = z
    .object({
      login: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/).optional(),
      password: z.string().min(1).max(256).optional(),
      roles: z.array(roleSchema).min(1).optional(),
      role: roleSchema.optional(),
      is_active: z.boolean().optional(),
    })
    .refine(
      (payload) =>
        payload.login !== undefined ||
        payload.password !== undefined ||
        payload.roles !== undefined ||
        payload.role !== undefined ||
        payload.is_active !== undefined,
      { message: 'No fields to update' },
    )
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const targetId = req.params.id
  const nextLogin = parsed.data.login !== undefined ? normalizeAdminLogin(parsed.data.login) : undefined
  let updated: AdminUser | null = null

  const result = withDb((db) => {
    const users = ensureAdminUsers(db)
    const user = users.find((item) => item.id === targetId)
    if (!user) return { ok: false as const, code: 404, error: 'Not found' }

    if (nextLogin) {
      const duplicate = users.find((item) => item.id !== targetId && normalizeAdminLogin(item.login) === nextLogin)
      if (duplicate) return { ok: false as const, code: 409, error: 'Login already exists' }
    }

    const roles =
      parsed.data.roles !== undefined || parsed.data.role !== undefined
        ? resolveRolesInput(parsed.data)
        : normalizeAdminRoles(user.roles)
    if (!roles.length) {
      return { ok: false as const, code: 400, error: 'Roles are required' }
    }

    const isActive = parsed.data.is_active ?? user.is_active
    const isLosingOwnerAccess = hasAdminRole(user, 'owner') && user.is_active && (!hasAdminRole(roles, 'owner') || !isActive)
    if (isLosingOwnerAccess && countActiveOwners(users) <= 1) {
      return { ok: false as const, code: 400, error: 'At least one active owner is required' }
    }

    if (nextLogin) user.login = nextLogin
    if (parsed.data.password !== undefined) {
      user.password_hash = hashAdminPassword(parsed.data.password)
    }
    user.roles = roles
    user.is_active = isActive
    user.updated_at = new Date().toISOString()
    updated = user
    return { ok: true as const, code: 200 }
  })

  if (!result.ok || !updated) {
    res.status(result.code).json({ success: false, error: result.error })
    return
  }

  addAuditLog(req.admin!.id, req.admin!.login, 'update', 'user', updated.id, `РћР±РЅРѕРІР»С‘РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ: ${updated.login}`)
  res.json({ success: true, data: toAdminUserPublic(updated) })
})

router.delete('/users/:id', requireAdminPermission('admin_users.write'), (req: Request, res: Response) => {
  const targetId = req.params.id
  const result = withDb((db) => {
    const users = ensureAdminUsers(db)
    const index = users.findIndex((user) => user.id === targetId)
    if (index === -1) return { ok: false as const, code: 404, error: 'Not found' }

    const user = users[index]
    const isLastOwner = hasAdminRole(user, 'owner') && user.is_active && countActiveOwners(users) <= 1
    if (isLastOwner) {
      return { ok: false as const, code: 400, error: 'At least one active owner is required' }
    }

    users.splice(index, 1)
    return { ok: true as const, code: 200 }
  })

  if (!result.ok) {
    res.status(result.code).json({ success: false, error: result.error })
    return
  }

  addAuditLog(req.admin!.id, req.admin!.login, 'delete', 'user', targetId, `РЈРґР°Р»С‘РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ (id: ${targetId})`)
  res.json({ success: true })
})

router.use('/upload', requireAdminPermission('upload.write'))
router.use('/home', requireAdminAnyPermission('home.read', 'home.write'))
router.use('/publish/status', requireAdminPermission('publish.read'))
router.use('/publish/apply', requireAdminPermission('publish.apply'))
router.use('/backups', requireAdminAnyPermission('publish.read', 'publish.apply'))
router.use('/leads', requireAdminAnyPermission('leads.read', 'leads.write'))
router.use('/feeds', requireAdminAnyPermission('feeds.read', 'feeds.write'))
router.use('/landing-feature-presets', requireAdminAnyPermission('landing_presets.read', 'landing_presets.write'))
router.use('/collections', requireAdminAnyPermission('collections.read', 'collections.write'))
router.use('/catalog', requireAdminAnyPermission('catalog.read', 'catalog.write'))
router.use('/import', requireAdminAnyPermission('import.read', 'import.write'))
router.use('/logs', requireAdminPermission('logs.read'))

router.get('/logs', (req: Request, res: Response) => {
  const page = Math.max(parseInt(req.query.page as string) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200)
  const entityFilter = typeof req.query.entity === 'string' ? req.query.entity : ''
  const actionFilter = typeof req.query.action === 'string' ? req.query.action : ''

  const data = withDbRead((db) => {
    const logsSource = Array.isArray(db.audit_logs) ? db.audit_logs : []
    let logs = [...logsSource].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
    if (entityFilter) logs = logs.filter((l) => l.entity === entityFilter)
    if (actionFilter) logs = logs.filter((l) => l.action === actionFilter)
    const total = logs.length
    const start = (page - 1) * limit
    return { items: logs.slice(start, start + limit), total, page, limit }
  })
  res.json({ success: true, data })
})

router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No file provided' })
    return
  }

  const ext = req.file.originalname.includes('.')
    ? req.file.originalname.slice(req.file.originalname.lastIndexOf('.')).toLowerCase()
    : ''
  const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif']
  const allowedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']
  const hasAllowedExt = ext ? allowedExt.includes(ext) : false
  const hasAllowedMime = allowedMime.includes((req.file.mimetype || '').toLowerCase())
  if (!hasAllowedExt && !hasAllowedMime) {
    res.status(400).json({ success: false, error: 'Invalid file type' })
    return
  }

  uploadImage({
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
  })
    .then((result) => {
      res.json({ success: true, data: { url: result.url } })
    })
    .catch((error) => {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      })
    })
})

router.get('/home', (req: Request, res: Response) => {
  const data = withDbRead((db) => db.home)
  res.json({ success: true, data })
})

router.get('/yandex-key/check', requireAdminAnyPermission('home.read', 'home.write'), async (req: Request, res: Response) => {
  const apiKey = (readDb().home?.maps?.yandex_maps_api_key || '').trim()
  if (!apiKey) {
    return res.json({ success: true, data: { has_key: false, geocoder: 'no_key', search: 'no_key' } })
  }

  const YANDEX_CHECK_TIMEOUT_MS = 10000
  const YANDEX_CHECK_MAX_ATTEMPTS = 2
  const YANDEX_CHECK_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

  async function fetchYandexWithRetry(url: string): Promise<globalThis.Response | null> {
    for (let attempt = 1; attempt <= YANDEX_CHECK_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(YANDEX_CHECK_TIMEOUT_MS),
          headers: { 'User-Agent': 'RWGroupWebsite/1.0' },
        })
        if (
          response.ok ||
          response.status === 401 ||
          response.status === 403 ||
          !YANDEX_CHECK_RETRYABLE_STATUSES.has(response.status) ||
          attempt >= YANDEX_CHECK_MAX_ATTEMPTS
        ) {
          return response
        }
      } catch {
        if (attempt >= YANDEX_CHECK_MAX_ATTEMPTS) return null
      }
    }
    return null
  }

  async function testGeocoder(): Promise<'ok' | 'auth_error' | 'error'> {
    try {
      const params = new URLSearchParams({ apikey: apiKey, geocode: 'РњРѕСЃРєРІР°', format: 'json', results: '1', lang: 'ru_RU' })
      const response = await fetchYandexWithRetry(`https://geocode-maps.yandex.ru/1.x/?${params}`)
      if (!response) return 'error'
      if (response.status === 403 || response.status === 401) return 'auth_error'
      if (!response.ok) return 'error'
      const json = await response.json() as { response?: { GeoObjectCollection?: unknown } }
      return json?.response?.GeoObjectCollection !== undefined ? 'ok' : 'error'
    } catch { return 'error' }
  }

  async function testSearch(): Promise<'ok' | 'auth_error' | 'error'> {
    try {
      const params = new URLSearchParams({
        text: 'РєРѕС„РµР№РЅСЏ',
        ll: '37.617,55.755',
        spn: '0.05,0.05',
        results: '1',
        lang: 'ru_RU',
        type: 'biz',
        apikey: apiKey,
      })
      const response = await fetchYandexWithRetry(`https://search-maps.yandex.ru/v1/?${params}`)
      if (!response) return 'error'
      if (response.status === 403 || response.status === 401) return 'auth_error'
      if (!response.ok) return 'error'
      const json = await response.json() as { features?: unknown[] }
      return Array.isArray(json?.features) ? 'ok' : 'error'
    } catch { return 'error' }
  }

  const [geocoder, search] = await Promise.all([testGeocoder(), testSearch()])
  return res.json({ success: true, data: { has_key: true, geocoder, search } })
})

router.put('/home', requireAdminPermission('home.write'), (req: Request, res: Response) => {
  const schema = z.object({ home: z.any() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  withDb((db) => {
    db.home = { ...db.home, ...(parsed.data.home as DbShape['home']), updated_at: new Date().toISOString() }
  })
  addAuditLog(req.admin!.id, req.admin!.login, 'update', 'home', undefined, 'РћР±РЅРѕРІР»РµРЅР° РІРёС‚СЂРёРЅР°')
  res.json({ success: true })
})

router.get('/publish/status', (req: Request, res: Response) => {
  const status = getPublishStatus()
  res.json({ success: true, data: status })
})

router.post('/publish/apply', (req: Request, res: Response) => {
  publishDraft()
  addAuditLog(req.admin!.id, req.admin!.login, 'publish', 'settings', undefined, 'РџСЂРёРјРµРЅРµРЅС‹ РёР·РјРµРЅРµРЅРёСЏ РЅР° СЃР°Р№С‚')
  const status = getPublishStatus()
  res.json({ success: true, data: status })
})

router.get('/backups', async (req: Request, res: Response) => {
  try {
    const backups = await listBackups()
    res.json({ success: true, data: backups })
  } catch {
    res.status(500).json({ success: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЃРїРёСЃРѕРє Р±РµРєР°РїРѕРІ' })
  }
})

router.post('/backups', requireAdminPermission('publish.apply'), async (req: Request, res: Response) => {
  const schema = z.object({
    label: z.string().max(120).optional(),
  })
  const parsed = schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  try {
    const created = await createManualBackup({
      label: parsed.data.label,
      adminId: req.admin?.id,
      adminLogin: req.admin?.login,
    })
    addAuditLog(
      req.admin!.id,
      req.admin!.login,
      'create',
      'settings',
      created.id,
      `РЎРѕР·РґР°РЅ Р±РµРєР°Рї: ${created.id}`,
      created.label ? `label=${created.label}` : undefined,
    )
    res.json({ success: true, data: created })
  } catch {
    res.status(500).json({ success: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ Р±РµРєР°Рї' })
  }
})

router.post('/backups/:id/restore', requireAdminPermission('publish.apply'), async (req: Request, res: Response) => {
  const id = req.params.id
  try {
    const restored = await restoreBackupById(id)
    if (!restored) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }
    addAuditLog(
      req.admin!.id,
      req.admin!.login,
      'update',
      'settings',
      restored.id,
      `Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅ Р±РµРєР°Рї: ${restored.id}`,
      restored.label ? `label=${restored.label}` : undefined,
    )
    res.json({ success: true, data: restored })
  } catch {
    res.status(500).json({ success: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ Р±РµРєР°Рї' })
  }
})

router.delete('/backups/:id', requireAdminPermission('publish.apply'), async (req: Request, res: Response) => {
  const id = req.params.id
  try {
    const deleted = await deleteBackupById(id)
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Not found' })
      return
    }
    addAuditLog(req.admin!.id, req.admin!.login, 'delete', 'settings', id, `РЈРґР°Р»РµРЅ Р±РµРєР°Рї: ${id}`)
    res.json({ success: true, data: { id } })
  } catch {
    res.status(500).json({ success: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ Р±РµРєР°Рї' })
  }
})

router.get('/leads', (req: Request, res: Response) => {
  const data = withDbRead((db) =>
    [...db.leads]
      .map((lead) => ({
        ...lead,
        lead_status: lead.lead_status || ('new' as LeadStatus),
        assignee: lead.assignee || '',
        admin_note: lead.admin_note || '',
      }))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  )
  res.json({ success: true, data })
})

router.get('/leads/processing-backups', requireAdminAnyPermission('leads.read', 'leads.write'), async (req: Request, res: Response) => {
  try {
    const backups = await listLeadProcessingBackups()
    res.json({ success: true, data: backups })
  } catch {
    res.status(500).json({ success: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р±РµРєР°РїС‹ РґР»СЏ Р»РёРґРѕРІ' })
  }
})

router.post('/leads/restore-processing', requireAdminPermission('leads.write'), async (req: Request, res: Response) => {
  const schema = z.object({
    backup_id: z.string().min(1),
  })
  const parsed = schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  try {
    const result = await restoreLeadProcessingByBackupId(parsed.data.backup_id)
    if (!result) {
      res.status(404).json({ success: false, error: 'Backup not found' })
      return
    }

    addAuditLog(
      req.admin!.id,
      req.admin!.login,
      'update',
      'lead',
      result.backup_id,
      `Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅР° РѕР±СЂР°Р±РѕС‚РєР° Р»РёРґРѕРІ РёР· Р±РµРєР°РїР°: ${result.backup_id}`,
      `applied=${result.applied}; unchanged=${result.unchanged}; missing=${result.missing}; snapshot=${result.total_snapshot}`,
    )
    res.json({ success: true, data: result })
  } catch {
    res.status(500).json({ success: false, error: 'РќРµ СѓРґР°Р»РѕСЃСЊ РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РѕР±СЂР°Р±РѕС‚РєСѓ Р»РёРґРѕРІ' })
  }
})

router.put('/leads/:id', requireAdminPermission('leads.write'), (req: Request, res: Response) => {
  const id = req.params.id
  const schema = z.object({
    lead_status: z.enum(['new', 'in_progress', 'done', 'spam']).optional(),
    assignee: z.string().max(80).optional(),
    admin_note: z.string().max(2000).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  if (
    parsed.data.lead_status === undefined &&
    parsed.data.assignee === undefined &&
    parsed.data.admin_note === undefined
  ) {
    res.status(400).json({ success: false, error: 'No fields to update' })
    return
  }

  let updatedLead: Lead | null = null
  const ok = withDb((db) => {
    const lead = db.leads.find((item) => item.id === id)
    if (!lead) return false

    if (parsed.data.lead_status !== undefined) {
      lead.lead_status = parsed.data.lead_status as LeadStatus
    }
    if (parsed.data.assignee !== undefined) {
      lead.assignee = parsed.data.assignee.trim()
    }
    if (parsed.data.admin_note !== undefined) {
      lead.admin_note = parsed.data.admin_note.trim()
    }
    lead.updated_at = new Date().toISOString()
    updatedLead = lead
    return true
  })

  if (!ok || !updatedLead) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  addAuditLog(req.admin!.id, req.admin!.login, 'update', 'lead', id, `РћР±РЅРѕРІР»С‘РЅ Р»РёРґ: ${updatedLead.name}`)
  res.json({ success: true, data: updatedLead })
})

router.get('/feeds', (req: Request, res: Response) => {
  const data = withDbRead((db) => db.feed_sources)
  res.json({ success: true, data })
})

router.get('/landing-feature-presets', (req: Request, res: Response) => {
  const data = withDbRead((db) => {
    const presets = Array.isArray(db.landing_feature_presets) ? db.landing_feature_presets : []
    const hiddenKeys = Array.isArray(db.hidden_landing_feature_preset_keys) ? db.hidden_landing_feature_preset_keys : []
    return {
      presets: [...presets].sort((a, b) => a.title.localeCompare(b.title, 'ru')),
      hidden_builtin_keys: [...hiddenKeys],
    }
  })
  res.json({ success: true, data })
})

router.post('/landing-feature-presets', requireAdminPermission('landing_presets.write'), (req: Request, res: Response) => {
  const schema = z.object({
    title: z.string().min(1).max(80),
    image: z.string().min(1).max(500),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const title = parsed.data.title.trim()
  const image = parsed.data.image.trim()
  if (!title || !image) {
    res.status(400).json({ success: false, error: 'Title and image are required' })
    return
  }

  const created = withDb((db) => {
    const presets = ensureCustomLandingFeaturePresets(db)
    const base = toCustomLandingFeatureKey(title) || 'feature'
    let key = `custom_${base}`
    let i = 2
    while (presets.some((preset) => preset.key === key)) {
      key = `custom_${base}_${i}`
      i += 1
    }
    const next: LandingFeaturePreset = { key, title, image }
    presets.push(next)
    return next
  })

  res.json({ success: true, data: created })
})

router.delete('/landing-feature-presets/:key', requireAdminPermission('landing_presets.write'), (req: Request, res: Response) => {
  const key = (req.params.key || '').trim()
  if (!key) {
    res.status(400).json({ success: false, error: 'Invalid key' })
    return
  }

  const isCustom = key.startsWith('custom_')

  const ok = withDb((db) => {
    if (isCustom) {
      const presets = ensureCustomLandingFeaturePresets(db)
      const before = presets.length
      db.landing_feature_presets = presets.filter((preset) => preset.key !== key)
      if (db.landing_feature_presets.length === before) return false
    } else {
      const hiddenKeys = ensureHiddenPresetKeys(db)
      if (hiddenKeys.includes(key)) return false
      hiddenKeys.push(key)
    }

    for (const complex of db.complexes) {
      if (!complex.landing?.feature_ticker?.length) continue
      complex.landing.feature_ticker = complex.landing.feature_ticker.filter((feature) => feature.preset_key !== key)
      complex.updated_at = new Date().toISOString()
    }
    return true
  })

  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true })
})

router.get('/feeds/diagnostics', (req: Request, res: Response) => {
  const data = withDbRead((db) => {
    const activeSourceIds = new Set(db.feed_sources.map((feed) => feed.id))
    const lastRunBySource: Record<string, any> = {}
    for (const r of db.import_runs) {
      if (r.action === 'delete' && activeSourceIds.has(r.source_id)) {
        continue
      }
      const current = lastRunBySource[r.source_id]
      if (!current || (r.started_at || '') > (current.started_at || '')) {
        lastRunBySource[r.source_id] = r
      }
    }

    const itemsBySource: Record<string, { properties: number; complexes: number; total: number }> = {}
    for (const p of db.properties) {
      const entry = itemsBySource[p.source_id] || { properties: 0, complexes: 0, total: 0 }
      entry.properties += 1
      entry.total += 1
      itemsBySource[p.source_id] = entry
    }
    for (const c of db.complexes) {
      const entry = itemsBySource[c.source_id] || { properties: 0, complexes: 0, total: 0 }
      entry.complexes += 1
      entry.total += 1
      itemsBySource[c.source_id] = entry
    }

    const diagnostics: Record<string, {
      reason?: string
      items: { properties: number; complexes: number; total: number }
      last_status?: 'success' | 'failed' | 'partial'
      last_started_at?: string
    }> = {}

    for (const feed of db.feed_sources) {
      const lastRun = lastRunBySource[feed.id]
      const items = itemsBySource[feed.id] || { properties: 0, complexes: 0, total: 0 }
      let reason: string | undefined

      if (!lastRun) {
        if (!feed.is_active) reason = 'РСЃС‚РѕС‡РЅРёРє РѕС‚РєР»СЋС‡РµРЅ'
        else if (feed.mode === 'url' && !feed.url) reason = 'URL РЅРµ СѓРєР°Р·Р°РЅ'
        else if (feed.mode === 'upload') reason = 'РћР¶РёРґР°РµС‚СЃСЏ Р·Р°РіСЂСѓР·РєР° С„Р°Р№Р»Р°'
        else if (items.total > 0) reason = 'Р”Р°РЅРЅС‹Рµ РµСЃС‚СЊ, РЅРѕ РЅРµС‚ Р·Р°РїРёСЃРµР№ РѕР± РёРјРїРѕСЂС‚Рµ'
        else if (feed.auto_refresh) reason = 'РђРІС‚РѕРѕР±РЅРѕРІР»РµРЅРёРµ РµС‰Рµ РЅРµ Р·Р°РїСѓСЃРєР°Р»РѕСЃСЊ'
        else reason = 'РРјРїРѕСЂС‚ РЅРµ Р·Р°РїСѓСЃРєР°Р»СЃСЏ'
      } else if (lastRun.status !== 'success' && lastRun.error_log) {
        reason = String(lastRun.error_log).split('\n')[0]
      }

      diagnostics[feed.id] = {
        reason,
        items,
        last_status: lastRun?.status,
        last_started_at: lastRun?.started_at,
      }
    }

    return diagnostics
  })

  res.json({ success: true, data })
})

router.post('/feeds', requireAdminPermission('feeds.write'), (req: Request, res: Response) => {
  const schema = z.object({ 
    name: z.string().min(1), 
    mode: z.enum(['upload', 'url']), 
    url: z.string().optional(), 
    format: z.enum(['xlsx', 'csv', 'xml', 'json']),
    mapping: z.record(z.string()).optional(),
    auto_refresh: z.boolean().optional(),
    refresh_interval_hours: z.number().min(1).max(168).optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const normalizedRefresh = resolveFeedRefreshSettings({
    mode: parsed.data.mode,
    url: parsed.data.url,
    auto_refresh: parsed.data.auto_refresh,
    refresh_interval_hours: parsed.data.refresh_interval_hours,
  })
  if (!normalizedRefresh.ok) {
    const errorMessage = 'error' in normalizedRefresh ? normalizedRefresh.error : 'Invalid payload'
    res.status(400).json({ success: false, error: errorMessage })
    return
  }

  const duplicate = withDbRead((db) => {
    const name = parsed.data.name.trim().toLowerCase()
    const url = normalizedRefresh.value.url
    return db.feed_sources.find((f) => {
      if (parsed.data.mode === 'url' && url && f.mode === 'url' && f.url === url) return true
      if (name && f.name.trim().toLowerCase() === name) return true
      return false
    })
  })
  if (duplicate) {
    res.status(409).json({ success: false, error: 'РўР°РєРѕР№ С„РёРґ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚' })
    return
  }
  const id = newId()
  withDb((db) => {
    db.feed_sources.unshift({
      id,
      name: parsed.data.name,
      mode: parsed.data.mode,
      url: normalizedRefresh.value.url,
      format: parsed.data.format,
      is_active: true,
      mapping: parsed.data.mapping,
      auto_refresh: normalizedRefresh.value.auto_refresh,
      refresh_interval_hours: normalizedRefresh.value.refresh_interval_hours,
      created_at: new Date().toISOString(),
    })
  })
  addAuditLog(req.admin!.id, req.admin!.login, 'create', 'feed', id, `РЎРѕР·РґР°РЅ РёСЃС‚РѕС‡РЅРёРє: ${parsed.data.name}`)
  res.json({ success: true, data: { id } })
})

router.put('/feeds/:id', requireAdminPermission('feeds.write'), (req: Request, res: Response) => {
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

  const normalizedCheck = withDbRead((db) => {
    const current = db.feed_sources.find((x) => x.id === id)
    if (!current) return { ok: false as const, code: 404 as const, error: 'Not found' }

    const nextMode = parsed.data.mode ?? current.mode
    const nextUrl = parsed.data.url ?? current.url
    const nextAutoRefresh = parsed.data.auto_refresh ?? current.auto_refresh
    const nextRefreshInterval = parsed.data.refresh_interval_hours ?? current.refresh_interval_hours
    const normalizedRefresh = resolveFeedRefreshSettings({
      mode: nextMode,
      url: nextUrl,
      auto_refresh: nextAutoRefresh,
      refresh_interval_hours: nextRefreshInterval,
    })
    if (!normalizedRefresh.ok) {
      const errorMessage = 'error' in normalizedRefresh ? normalizedRefresh.error : 'Invalid payload'
      return { ok: false as const, code: 400 as const, error: errorMessage }
    }

    const nextName = (parsed.data.name ?? current.name).trim().toLowerCase()
    const conflict = db.feed_sources.find((f) => {
      if (f.id === id) return false
      if (
        nextMode === 'url' &&
        normalizedRefresh.value.url &&
        f.mode === 'url' &&
        f.url === normalizedRefresh.value.url
      ) return true
      if (nextName && f.name.trim().toLowerCase() === nextName) return true
      return false
    })
    if (conflict) {
      return { ok: false as const, code: 409 as const, error: 'РўР°РєРѕР№ С„РёРґ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚' }
    }

    return {
      ok: true as const,
      normalizedRefresh: normalizedRefresh.value,
    }
  })
  if (!normalizedCheck.ok) {
    res.status(normalizedCheck.code).json({ success: false, error: normalizedCheck.error })
    return
  }

  const ok = withDb((db) => {
    const fs = db.feed_sources.find((x) => x.id === id)
    if (!fs) return false
    Object.assign(fs, parsed.data)
    fs.url = normalizedCheck.normalizedRefresh.url
    fs.auto_refresh = normalizedCheck.normalizedRefresh.auto_refresh
    fs.refresh_interval_hours = normalizedCheck.normalizedRefresh.refresh_interval_hours
    return true
  })
  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  addAuditLog(req.admin!.id, req.admin!.login, 'update', 'feed', id, `РћР±РЅРѕРІР»С‘РЅ РёСЃС‚РѕС‡РЅРёРє (id: ${id})`)
  res.json({ success: true })
})

router.delete('/feeds/:id', requireAdminPermission('feeds.write'), (req: Request, res: Response) => {
  const id = req.params.id
  const snapshot = withDbRead((db) => db.feed_sources.find((x) => x.id === id))
  const ok = withDb((db) => {
    const before = db.feed_sources.length
    db.feed_sources = db.feed_sources.filter((x) => x.id !== id)
    
    if (db.feed_sources.length !== before) {
      // Cascade hard-delete properties/complexes for this source + clean stale references.
      const deletedComplexIds = new Set(
        db.complexes
          .filter((complex) => complex.source_id === id)
          .map((complex) => complex.id),
      )
      const deletedPropertyIds = new Set(
        db.properties
          .filter((property) => property.source_id === id || (property.complex_id && deletedComplexIds.has(property.complex_id)))
          .map((property) => property.id),
      )

      db.properties = db.properties.filter((property) => !deletedPropertyIds.has(property.id))
      db.complexes = db.complexes.filter((complex) => !deletedComplexIds.has(complex.id))
      cleanupCatalogReferences(db, deletedPropertyIds, deletedComplexIds)
      return true
    }
    return false
  })
  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  if (snapshot) {
    withDb((db) => {
      db.import_runs.unshift({
        id: newId(),
        source_id: snapshot.id,
        entity: 'property',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: 'failed',
        stats: { inserted: 0, updated: 0, hidden: 0 },
        error_log: 'РСЃС‚РѕС‡РЅРёРє СѓРґР°Р»РµРЅ',
        feed_name: snapshot.name,
        feed_url: snapshot.url,
        action: 'delete',
      })
    })
  }
  addAuditLog(req.admin!.id, req.admin!.login, 'delete', 'feed', id, `РЈРґР°Р»С‘РЅ РёСЃС‚РѕС‡РЅРёРє: ${snapshot?.name || id}`)
  res.json({ success: true })
})

router.get('/collections', (req: Request, res: Response) => {
  const data = withDbRead((db) => [...db.collections].sort((a, b) => b.priority - a.priority))
  res.json({ success: true, data })
})

router.post('/collections', requireAdminPermission('collections.write'), (req: Request, res: Response) => {
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
  addAuditLog(req.admin!.id, req.admin!.login, 'create', 'collection', id, `РЎРѕР·РґР°РЅР° РїРѕРґР±РѕСЂРєР°: ${parsed.data.title}`)
  res.json({ success: true, data: { id } })
})

router.put('/collections/:id', requireAdminPermission('collections.write'), (req: Request, res: Response) => {
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
  addAuditLog(req.admin!.id, req.admin!.login, 'update', 'collection', id, `РћР±РЅРѕРІР»РµРЅР° РїРѕРґР±РѕСЂРєР° (id: ${id})`)
  res.json({ success: true })
})

router.delete('/collections/:id', requireAdminPermission('collections.write'), (req: Request, res: Response) => {
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
  addAuditLog(req.admin!.id, req.admin!.login, 'delete', 'collection', id, `РЈРґР°Р»РµРЅР° РїРѕРґР±РѕСЂРєР° (id: ${id})`)
  res.json({ success: true })
})

router.post('/collections/:id/toggle-status', requireAdminPermission('collections.write'), (req: Request, res: Response) => {
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
  const data = withDbRead((db) => {
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

router.post('/collections/preview-auto', requireAdminPermission('collections.write'), (req: Request, res: Response) => {
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

  const data = withDbRead((db) => {
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

router.post('/collections/:id/validate-items', requireAdminPermission('collections.write'), (req: Request, res: Response) => {
  const id = req.params.id
  const schema = z.object({ cleanInvalid: z.boolean().optional() })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const validateItems = (db: DbShape, cleanInvalid: boolean) => {
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

    if (cleanInvalid && invalidIds.length > 0) {
      collection.items = validItems
      collection.updated_at = new Date().toISOString()
    }

    return {
      totalItems: collection.items.length,
      validItems: validItems.length,
      invalidItems: invalidIds,
      cleaned: cleanInvalid,
    }
  }

  const shouldClean = parsed.data.cleanInvalid === true
  const result = shouldClean
    ? withDb((db) => validateItems(db, true))
    : withDbRead((db) => validateItems(db, false))

  if (!result) {
    res.status(404).json({ success: false, error: 'Not found or not in manual mode' })
    return
  }
  res.json({ success: true, data: result })
})

router.get('/catalog/outdated', (req: Request, res: Response) => {
  const data = withDbRead((db) => {
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
  const sourceId = typeof req.query.source_id === 'string' ? req.query.source_id.trim() : ''
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

  const data = withDbRead((db) => {
    const items =
      type === 'property'
          ? db.properties
              .filter((p) => (sourceId ? p.source_id === sourceId : true))
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
              .filter((c) => (sourceId ? c.source_id === sourceId : true))
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

router.get('/catalog/complex/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const data = withDbRead((db) => {
    const complex = db.complexes.find((item) => item.id === id)
    if (!complex) return null
    const properties = db.properties
      .filter((item) => (item.complex_id ? item.complex_id === complex.id : item.complex_external_id === complex.external_id))
      .sort((a, b) => a.price - b.price)
    return { complex, properties }
  })
  if (!data) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }
  res.json({ success: true, data })
})

router.post('/catalog/complex/:id/nearby/generate', requireAdminPermission('catalog.write'), async (req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: 'РђРІС‚РѕРїРѕРёСЃРє РјРµСЃС‚ РѕС‚РєР»СЋС‡РµРЅ. РСЃРїРѕР»СЊР·СѓР№С‚Рµ СЂСѓС‡РЅРѕРµ СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ СЂР°Р·РґРµР»Р° В«РњРµСЃС‚Р° РїРѕР±Р»РёР·РѕСЃС‚РёВ».',
  })
})

router.post('/catalog/complex/:id/nearby/photo-variants', requireAdminPermission('catalog.write'), async (req: Request, res: Response) => {
  res.status(410).json({
    success: false,
    error: 'РђРІС‚РѕРїРѕРґР±РѕСЂ С„РѕС‚Рѕ РѕС‚РєР»СЋС‡РµРЅ. Р”РѕР±Р°РІР»СЏР№С‚Рµ РёР·РѕР±СЂР°Р¶РµРЅРёСЏ РІСЂСѓС‡РЅСѓСЋ (URL РёР»Рё Р·Р°РіСЂСѓР·РєР° С„Р°Р№Р»Р°).',
  })
})

router.put('/catalog/items/:type/:id', requireAdminPermission('catalog.write'), (req: Request, res: Response) => {
  const { type, id } = req.params

  const landingTagSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
  })

  const landingFactSchema = z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    value: z.string().optional(),
    subtitle: z.string().optional(),
    image: z.string().optional(),
    card_col_span: z.number().int().min(1).max(3).optional(),
    card_row_span: z.number().int().min(1).max(2).optional(),
  })

  const landingFeatureSchema = z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    image: z.string().optional(),
    preset_key: z.string().optional(),
  })

  const landingPlanSchema = z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    price: z.string().optional(),
    area: z.string().optional(),
    variants: z.number().optional(),
    bedrooms: z.number().optional(),
    note: z.string().optional(),
    preview_image: z.string().optional(),
    preview_images: z.array(z.string()).optional(),
  })

  const landingAccordionItemSchema = z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    text: z.string().optional(),
    image: z.string().optional(),
    open_by_default: z.boolean().optional(),
  })

  const landingAccordionSchema = z.object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    items: z.array(landingAccordionItemSchema).max(1),
  })

  const landingInfoCardSchema = z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    cover_image: z.string().optional(),
    modal_title: z.string().optional(),
    modal_text: z.string().optional(),
    gallery_images: z.array(z.string()).max(24).optional(),
    card_col_span: z.number().int().min(1).max(3).optional(),
    card_row_span: z.number().int().min(1).max(2).optional(),
  })

  const landingInfoSectionSchema = z.object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    items: z.array(landingInfoCardSchema).max(12),
  })

  const landingNearbyPlaceSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    category_key: z.string().optional(),
    group: z.enum(['life', 'leisure', 'family']).optional(),
    emoji: z.string().optional(),
    lat: z.number(),
    lon: z.number(),
    walk_minutes: z.number(),
    drive_minutes: z.number(),
    rating: z.number().optional(),
    reviews_count: z.number().optional(),
    image_url: z.string().optional(),
    image_variants: z.array(z.string()).optional(),
    image_fallback: z.boolean().optional(),
    image_custom: z.boolean().optional(),
  })

  const landingNearbyCollectionSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    group: z.enum(['life', 'leisure', 'family']).optional(),
  })

  const landingNearbySchema = z.object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    refreshed_at: z.string().optional(),
    collections: z.array(landingNearbyCollectionSchema).max(20).optional(),
    selected_ids: z.array(z.string()).max(20),
    candidates: z.array(landingNearbyPlaceSchema).max(20),
  })

  const landingSchema = z.object({
    enabled: z.boolean(),
    accent_color: z.string().optional(),
    surface_color: z.string().optional(),
    hero_image: z.string().optional(),
    preview_photo_label: z.string().optional(),
    cta_label: z.string().optional(),
    tags: z.array(landingTagSchema),
    facts: z.array(landingFactSchema).max(12),
    feature_ticker: z.array(landingFeatureSchema),
    plans: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      cta_label: z.string().optional(),
      items: z.array(landingPlanSchema),
    }),
    accordion: landingAccordionSchema.optional(),
    info_cards: landingInfoSectionSchema.optional(),
    nearby: landingNearbySchema.optional(),
  })

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
    mortgage_available: z.boolean().optional(),
    installment_available: z.boolean().optional(),
    subsidy_available: z.boolean().optional(),
    military_mortgage_available: z.boolean().optional(),
    building_queue: z.number().optional(),
    building_type: z.string().optional(),
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
    address: z.string().optional(),
    mortgage_available: z.boolean().optional(),
    installment_available: z.boolean().optional(),
    subsidy_available: z.boolean().optional(),
    military_mortgage_available: z.boolean().optional(),
    queue_min: z.number().optional(),
    building_type: z.string().optional(),
    geo_lat: z.number().min(-90).max(90).optional(),
    geo_lon: z.number().min(-180).max(180).optional(),
    landing: landingSchema.optional(),
  }

  const schema = type === 'property' ? z.object(propertyFields) : z.object(complexFields)
  const parsed = schema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload', details: parsed.error })
    return
  }

  let nextStatus: 'active' | 'hidden' | 'archived' | undefined
  let previousStatus: 'active' | 'hidden' | 'archived' | undefined
  let touchedUpdatedAt: string | undefined
  let touchedComplexExternalId: string | undefined
  let restoredLinkedDraftProperties = 0

  const ok = withDb((db) => {
    if (type === 'property') {
      const item = db.properties.find(p => p.id === id)
      if (!item) return false
      Object.assign(item, parsed.data)
      item.updated_at = new Date().toISOString()
      touchedUpdatedAt = item.updated_at
      nextStatus = parsed.data.status
      return true
    } else if (type === 'complex') {
      const item = db.complexes.find(c => c.id === id)
      if (!item) return false
      previousStatus = item.status
      Object.assign(item, parsed.data)
      item.updated_at = new Date().toISOString()
      touchedUpdatedAt = item.updated_at
      nextStatus = parsed.data.status

      touchedComplexExternalId = item.external_id
      const shouldRestoreLinkedProperties = nextStatus === 'active' && previousStatus !== 'active'
      if (shouldRestoreLinkedProperties) {
        for (const property of db.properties) {
          const linkedById = property.complex_id === item.id
          const linkedByExternal = Boolean(item.external_id) && property.complex_external_id === item.external_id
          if (!linkedById && !linkedByExternal) continue
          if (property.status === 'active') continue
          property.status = 'active'
          property.updated_at = item.updated_at
          restoredLinkedDraftProperties += 1
        }
      }
      return true
    }
    return false
  })

  if (!ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }

  // Keep visibility changes in sync for public API without publishing unrelated drafts.
  if (nextStatus) {
    try {
      const published = readPublishedDb()
      let publishedChanged = false
      if (type === 'property') {
        const publishedItem = published.properties.find((p) => p.id === id)
        if (publishedItem) {
          publishedItem.status = nextStatus
          if (touchedUpdatedAt) publishedItem.updated_at = touchedUpdatedAt
          publishedChanged = true
        }
      } else if (type === 'complex') {
        const publishedItem = published.complexes.find((c) => c.id === id)
        if (publishedItem) {
          publishedItem.status = nextStatus
          if (touchedUpdatedAt) publishedItem.updated_at = touchedUpdatedAt
          publishedChanged = true
        }

        const shouldRestoreLinkedPublishedProperties = nextStatus === 'active' && previousStatus !== 'active'
        if (shouldRestoreLinkedPublishedProperties) {
          const restoreTimestamp = touchedUpdatedAt || new Date().toISOString()
          for (const property of published.properties) {
            const linkedById = property.complex_id === id
            const linkedByExternal = Boolean(touchedComplexExternalId) && property.complex_external_id === touchedComplexExternalId
            if (!linkedById && !linkedByExternal) continue
            if (property.status === 'active') continue
            property.status = 'active'
            property.updated_at = restoreTimestamp
            publishedChanged = true
          }
        }
      }

      if (publishedChanged) writePublishedDb(published)
    } catch (error) {
      console.warn(`[admin] Failed to sync published status for ${type}:${id}`, error)
    }
  }

  const entityType = type === 'property' ? 'property' : 'complex' as const
  const restoreDetails = type === 'complex' && restoredLinkedDraftProperties > 0
    ? `; restored linked properties=${restoredLinkedDraftProperties}`
    : ''
  addAuditLog(req.admin!.id, req.admin!.login, 'update', entityType, id, `РћР±РЅРѕРІР»С‘РЅ ${type === 'property' ? 'Р»РѕС‚' : 'Р–Рљ'} (id: ${id})${restoreDetails}`)
  res.json({ success: true })
})

router.delete('/catalog/items/:type/:id', requireAdminPermission('catalog.write'), (req: Request, res: Response) => {
  const { type, id } = req.params

  const result = withDb((db) => {
    if (type === 'property') {
      const existing = db.properties.find((property) => property.id === id)
      if (!existing) return { ok: false as const }

      const deletedPropertyIds = new Set([id])
      db.properties = db.properties.filter((property) => property.id !== id)
      const cleanup = cleanupCatalogReferences(db, deletedPropertyIds, new Set())

      return {
        ok: true as const,
        deletedProperties: 1,
        deletedComplexes: 0,
        cleanup,
      }
    }

    if (type === 'complex') {
      const complex = db.complexes.find((item) => item.id === id)
      if (!complex) return { ok: false as const }

      const deletedComplexIds = new Set([id])
      const deletedPropertyIds = new Set(
        db.properties
          .filter((property) => property.complex_id === id || (complex.external_id && property.complex_external_id === complex.external_id))
          .map((property) => property.id),
      )

      db.complexes = db.complexes.filter((item) => item.id !== id)
      db.properties = db.properties.filter((property) => !deletedPropertyIds.has(property.id))
      const cleanup = cleanupCatalogReferences(db, deletedPropertyIds, deletedComplexIds)

      return {
        ok: true as const,
        deletedProperties: deletedPropertyIds.size,
        deletedComplexes: 1,
        cleanup,
      }
    }

    return { ok: false as const }
  })

  if (!result.ok) {
    res.status(404).json({ success: false, error: 'Not found' })
    return
  }

  const entityType = type === 'property' ? 'property' : 'complex' as const
  addAuditLog(
    req.admin!.id,
    req.admin!.login,
    'delete',
    entityType,
    id,
    `Catalog delete ${type} id=${id}: removed properties=${result.deletedProperties}, complexes=${result.deletedComplexes}, cleaned collection links=${result.cleanup.collectionItemsRemoved}, cleaned featured links=${result.cleanup.featuredRemoved}`,
  )
  res.json({ success: true })
})

router.delete('/catalog/reset', requireAdminPermission('catalog.write'), (req: Request, res: Response) => {
  const summary = withDb((db) => {
    const deletedPropertyIds = new Set(db.properties.map((property) => property.id))
    const deletedComplexIds = new Set(db.complexes.map((complex) => complex.id))
    db.properties = []
    db.complexes = []
    const cleanup = cleanupCatalogReferences(db, deletedPropertyIds, deletedComplexIds)
    return {
      deletedProperties: deletedPropertyIds.size,
      deletedComplexes: deletedComplexIds.size,
      cleanup,
    }
  })

  addAuditLog(
    req.admin!.id,
    req.admin!.login,
    'delete',
    'property',
    undefined,
    `Catalog reset: removed properties=${summary.deletedProperties}, complexes=${summary.deletedComplexes}, cleaned collection links=${summary.cleanup.collectionItemsRemoved}, cleaned featured links=${summary.cleanup.featuredRemoved}`,
  )
  res.json({ success: true })
})

router.get('/import/runs', (req: Request, res: Response) => {
  const data = withDbRead((db) => [...db.import_runs].sort((a, b) => (b.started_at || '').localeCompare(a.started_at || '')))
  res.json({ success: true, data })
})

router.post('/import/run', requireAdminPermission('import.write'), upload.single('file'), async (req: Request, res: Response) => {
  const schema = z.object({
    source_id: z.string().min(1),
    entity: z.enum(['property', 'complex']),
    url: z.string().optional(),
    rows: z.string().optional(),
    hide_invalid: z.coerce.boolean().optional(),
    restore_archived: z.coerce.boolean().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }
  const lockKey = `${parsed.data.source_id}:${parsed.data.entity}`
  if (hasActiveImportLock(lockKey)) {
    res.status(409).json({ success: false, error: 'РРјРїРѕСЂС‚ СѓР¶Рµ РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ РґР»СЏ СЌС‚РѕРіРѕ РёСЃС‚РѕС‡РЅРёРєР°' })
    return
  }
  importLocks.set(lockKey, Date.now())
  const runId = newId()
  const startedAt = new Date().toISOString()
  const run: {
    id: string
    source_id: string
    entity: 'property' | 'complex'
    started_at: string
    status: 'success' | 'failed' | 'partial'
    stats: { inserted: number; updated: number; hidden: number }
    feed_name?: string
    feed_url?: string
    feed_file?: string
    target_complex_id?: string
    action?: 'import' | 'preview' | 'delete'
  } = {
    id: runId,
    source_id: parsed.data.source_id,
    entity: parsed.data.entity,
    started_at: startedAt,
    status: 'success',
    stats: { inserted: 0, updated: 0, hidden: 0 },
    action: 'import',
  }

  let errorLog = ''
  const sourceSnapshot = withDbRead((db) => db.feed_sources.find(s => s.id === parsed.data.source_id))
  if (sourceSnapshot) {
    run.feed_name = sourceSnapshot.name
    run.feed_url = sourceSnapshot.url
  }
  if (req.file?.originalname) {
    run.feed_file = req.file.originalname
  }

  try {
    let rows: Record<string, unknown>[] = []
    
    if (parsed.data.rows) {
      try {
        rows = JSON.parse(parsed.data.rows)
        if (!Array.isArray(rows)) throw new Error('Rows must be an array')
        assertFeedRowLimit(rows.length)
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Feed has too many rows')) {
          throw e
        }
        throw new Error('Invalid rows JSON')
      }
    } else {
      const buffer = await getBuffer(req, parsed.data.url)
      const fileName = req.file?.originalname || parsed.data.url || 'feed'
      const ext = guessExt(fileName)
      rows = parseRows(buffer, ext)
    }

    const restoreArchived = parsed.data.restore_archived !== false

    const stats = withDb((db) => {
      const source = db.feed_sources.find(s => s.id === parsed.data.source_id)
      const mapping = source?.mapping

      if (parsed.data.entity === 'complex') {
        return upsertComplexes(db, parsed.data.source_id, rows, mapping, { restoreArchived })
      }
      
      // Auto-upsert complexes from properties to ensure linking works
      const complexStats = upsertComplexesFromProperties(db, parsed.data.source_id, rows, mapping, { restoreArchived })
      const propertyStats = upsertProperties(db, parsed.data.source_id, rows, mapping, {
        hideInvalid: parsed.data.hide_invalid,
        restoreArchived,
      })
      return { ...propertyStats, targetComplexId: complexStats.targetComplexId }
    })

    run.stats = { inserted: stats.inserted, updated: stats.updated, hidden: stats.hidden }
    const targetComplexId = (stats as { targetComplexId?: string }).targetComplexId
    if (typeof targetComplexId === 'string' && targetComplexId) {
      run.target_complex_id = targetComplexId
    }

    if (stats.errors.length > 0) {
      run.status = stats.errors.length === rows.length ? 'failed' : 'partial'
      errorLog = `${stats.errors.length} СЃС‚СЂРѕРє СЃ РѕС€РёР±РєР°РјРё:\n` +
        stats.errors.slice(0, 50).map(e =>
          `РЎС‚СЂРѕРєР° ${e.rowIndex}${e.externalId ? ` (${e.externalId})` : ''}: ${e.error}`
        ).join('\n')
    }
  } catch (e) {
    run.status = 'failed'
    errorLog = e instanceof Error ? e.message : 'Unknown error'
  } finally {
    importLocks.delete(lockKey)
    withDb((db) => {
      db.import_runs.unshift({
        ...run,
        finished_at: new Date().toISOString(),
        error_log: errorLog || undefined,
      })

      appendAuditLog(
        db,
        req.admin!.id,
        req.admin!.login,
        'import',
        'property',
        run.source_id,
        `Import (${run.entity}): ${run.status} +${run.stats.inserted}/${run.stats.updated}/${run.stats.hidden}`,
        run.feed_name || undefined,
      )
    })
  }
  if (run.status === 'failed') {
    res.status(500).json({ success: false, error: 'Import failed', details: errorLog })
    return
  }
  res.json({ success: true, data: run })
})

router.post('/import/trendagent/complexes', requireAdminPermission('import.write'), async (req: Request, res: Response) => {
  const schema = z.object({
    source_id: z.string().min(1),
    force_refresh: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    query: z.string().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const source = withDbRead((db) => db.feed_sources.find((s) => s.id === parsed.data.source_id))
  if (!source) {
    res.status(404).json({ success: false, error: 'Source not found' })
    return
  }
  if (!source.url) {
    res.status(400).json({ success: false, error: 'Source URL is required for TrendAgent selection' })
    return
  }

  try {
    const dataset = await loadTrendAgentDataset(source.url, parsed.data.force_refresh === true, 'list')
    const allItems = buildTrendAgentComplexOptions(dataset)
    const query = stringValue(parsed.data.query).toLowerCase()
    const filtered = query
      ? allItems.filter((item) =>
          [item.title, item.district, item.developer, item.address, item.block_id]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        )
      : allItems
    const page = parsed.data.page || 1
    const limit = parsed.data.limit || 50
    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * limit
    const items = filtered.slice(start, start + limit)

    res.json({
      success: true,
      data: {
        source_id: source.id,
        source_url: source.url,
        total,
        page: safePage,
        limit,
        total_pages: totalPages,
        items,
      },
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Failed to load TrendAgent feed'
    res.status(500).json({ success: false, error: 'TrendAgent list failed', details })
  }
})

router.post('/import/trendagent/run', requireAdminPermission('import.write'), async (req: Request, res: Response) => {
  const schema = z.object({
    source_id: z.string().min(1),
    entity: z.enum(['property', 'complex']),
    block_ids: z.array(z.string().min(1)).optional(),
    full_city: z.coerce.boolean().optional(),
    hide_invalid: z.coerce.boolean().optional(),
    restore_archived: z.coerce.boolean().optional(),
    force_refresh: z.coerce.boolean().optional(),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Invalid payload' })
    return
  }

  const lockKey = `${parsed.data.source_id}:${parsed.data.entity}:trendagent`
  if (hasActiveImportLock(lockKey)) {
    res.status(409).json({ success: false, error: 'Import already running for this source' })
    return
  }
  importLocks.set(lockKey, Date.now())

  const sourceSnapshot = withDbRead((db) => db.feed_sources.find((s) => s.id === parsed.data.source_id))
  if (!sourceSnapshot) {
    importLocks.delete(lockKey)
    res.status(404).json({ success: false, error: 'Source not found' })
    return
  }
  if (!sourceSnapshot.url) {
    importLocks.delete(lockKey)
    res.status(400).json({ success: false, error: 'Source URL is required for TrendAgent import' })
    return
  }
  const adminId = req.admin!.id
  const adminLogin = req.admin!.login

  const run: {
    id: string
    source_id: string
    entity: 'property' | 'complex'
    started_at: string
    status: 'success' | 'failed' | 'partial'
    stats: { inserted: number; updated: number; hidden: number }
    feed_name?: string
    feed_url?: string
    target_complex_id?: string
    action?: 'import' | 'preview' | 'delete'
  } = {
    id: newId(),
    source_id: parsed.data.source_id,
    entity: parsed.data.entity,
    started_at: new Date().toISOString(),
    status: 'success',
    stats: { inserted: 0, updated: 0, hidden: 0 },
    feed_name: sourceSnapshot.name,
    feed_url: sourceSnapshot.url,
    action: 'import',
  }

  const executeTrendAgentImport = async (): Promise<string> => {
    let errorLog = ''
    try {
      importLocks.set(lockKey, Date.now())
      const dataset = await loadTrendAgentDataset(
        sourceSnapshot.url,
        parsed.data.force_refresh === true,
        parsed.data.entity === 'complex' ? 'complex' : 'full',
      )
      importLocks.set(lockKey, Date.now())

      let selectedBlockIds: Set<string>
      if (parsed.data.full_city === true) {
        selectedBlockIds = new Set(
          dataset.blocks
            .map((block) => stringValue(block._id))
            .filter(Boolean),
        )
        if (selectedBlockIds.size === 0) {
          throw new Error('No blocks found in TrendAgent feed')
        }
      } else {
        selectedBlockIds = new Set((parsed.data.block_ids || []).map((id) => id.trim()).filter(Boolean))
        if (selectedBlockIds.size === 0) {
          throw new Error('At least one block_id is required')
        }
      }

      const rows = parsed.data.entity === 'complex'
        ? buildTrendAgentComplexImportRows(dataset, selectedBlockIds)
        : buildTrendAgentImportRows(dataset, selectedBlockIds)
      if (rows.length === 0) {
        throw new Error(
          parsed.data.entity === 'complex'
            ? 'No complexes found for selected block_ids'
            : 'No apartments found for selected complexes',
        )
      }
      assertFeedRowLimit(rows.length)
      importLocks.set(lockKey, Date.now())

      const restoreArchived = parsed.data.restore_archived !== false
      const stats = withDb((db) => {
        const source = db.feed_sources.find((s) => s.id === parsed.data.source_id)
        const mapping = source?.mapping

        if (parsed.data.entity === 'complex') {
          return upsertComplexes(db, parsed.data.source_id, rows, mapping, { restoreArchived })
        }

        const complexStats = upsertComplexesFromProperties(db, parsed.data.source_id, rows, mapping, { restoreArchived })
        const propertyStats = upsertProperties(db, parsed.data.source_id, rows, mapping, {
          hideInvalid: parsed.data.hide_invalid,
          restoreArchived,
        })
        return { ...propertyStats, targetComplexId: complexStats.targetComplexId }
      })

      run.stats = { inserted: stats.inserted, updated: stats.updated, hidden: stats.hidden }
      const targetComplexId = (stats as { targetComplexId?: string }).targetComplexId
      if (typeof targetComplexId === 'string' && targetComplexId) {
        run.target_complex_id = targetComplexId
      }

      if (stats.errors.length > 0) {
        run.status = stats.errors.length === rows.length ? 'failed' : 'partial'
        errorLog =
          `${stats.errors.length} rows with errors:\n` +
          stats.errors
            .slice(0, 50)
            .map((item) => `Row ${item.rowIndex}${item.externalId ? ` (${item.externalId})` : ''}: ${item.error}`)
            .join('\n')
      }
    } catch (error) {
      run.status = 'failed'
      errorLog = error instanceof Error ? error.message : 'Unknown error'
    } finally {
      importLocks.delete(lockKey)
      withDb((db) => {
        db.import_runs.unshift({
          ...run,
          finished_at: new Date().toISOString(),
          error_log: errorLog || undefined,
        })
        appendAuditLog(
          db,
          adminId,
          adminLogin,
          'import',
          'property',
          run.source_id,
          `TrendAgent ${parsed.data.full_city === true ? 'full-city' : 'selected'} import (${run.entity}): ${run.status} +${run.stats.inserted}/${run.stats.updated}/${run.stats.hidden}`,
          run.feed_name || undefined,
        )
      })
    }
    return errorLog
  }

  const shouldQueueTrendAgentImport = parsed.data.full_city === true || parsed.data.entity === 'property'
  if (shouldQueueTrendAgentImport) {
    const scopeLabel = parsed.data.full_city === true ? 'всего города' : 'выбранных ЖК'
    void executeTrendAgentImport()
    res.status(202).json({
      success: true,
      data: {
        queued: true,
        run_id: run.id,
        source_id: run.source_id,
        entity: run.entity,
        message: `Импорт ${scopeLabel} запущен в фоне. Следите за статусом в журнале импортов.`,
      },
    })
    return
  }

  const errorLog = await executeTrendAgentImport()
  if (run.status === 'failed') {
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
  if (!row || typeof row !== 'object' || Array.isArray(row)) return
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
      errors.push('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ external_id (РёР»Рё id/externalId)')
    } else {
      mappedFields.push('external_id')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'external_id', row)
    }

    const bedrooms = asNumber(row.bedrooms ?? row.rooms)
    if (typeof bedrooms !== 'number') {
      errors.push('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РёР»Рё РЅРµРєРѕСЂСЂРµРєС‚РЅРѕРµ Р·РЅР°С‡РµРЅРёРµ bedrooms (РёР»Рё rooms)')
    } else {
      mappedFields.push('bedrooms')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'bedrooms', row)
    }

    const price = asNumber(row.price)
    if (typeof price !== 'number') {
      errors.push('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РёР»Рё РЅРµРєРѕСЂСЂРµРєС‚РЅРѕРµ Р·РЅР°С‡РµРЅРёРµ price')
    } else {
      mappedFields.push('price')
    }

    const area = asNumber(row.area_total ?? row.area)
    if (typeof area !== 'number') {
      errors.push('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РёР»Рё РЅРµРєРѕСЂСЂРµРєС‚РЅРѕРµ Р·РЅР°С‡РµРЅРёРµ area_total (РёР»Рё area)')
    } else {
      mappedFields.push('area_total')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'area_total', row)
    }

    // District validation
    const district = asString(row.district)
    if (!district) {
      warnings.push('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ СЂР°Р№РѕРЅ (district) - С„РёР»СЊС‚СЂС‹ РїРѕ СЂР°Р№РѕРЅСѓ СЂР°Р±РѕС‚Р°С‚СЊ РЅРµ Р±СѓРґСѓС‚')
    } else {
      mappedFields.push('district')
    }

    // Category validation
    const category = asString(row.category)
    if (!category || !['newbuild', 'secondary', 'rent'].includes(category)) {
      warnings.push('РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ РёР»Рё РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‰Р°СЏ РєР°С‚РµРіРѕСЂРёСЏ (category) - РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ Р±СѓРґРµС‚ newbuild')
    } else {
      mappedFields.push('category')
    }

    // Deal type validation
    const dealType = asString(row.deal_type)
    if (!dealType || !['sale', 'rent'].includes(dealType)) {
      warnings.push('РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РёР»Рё РѕС‚СЃСѓС‚СЃС‚РІСѓСЋС‰РёР№ С‚РёРї СЃРґРµР»РєРё (deal_type) - РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ Р±СѓРґРµС‚ sale')
    } else {
      mappedFields.push('deal_type')
    }

    // Metro (optional - not all feeds have it)
    if (row.metro && asString(row.metro)) {
      mappedFields.push('metro')
    }

    if (!row.title && !row.name) {
      warnings.push('РќРµС‚ РїРѕР»СЏ title/name - Р±СѓРґРµС‚ СЃРіРµРЅРµСЂРёСЂРѕРІР°РЅРѕ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё')
    } else {
      mappedFields.push('title')
    }

    if (!row.images && !row.image_urls && !row.photos && !row.image) {
      warnings.push('РР·РѕР±СЂР°Р¶РµРЅРёСЏ РЅРµ РїСЂРµРґРѕСЃС‚Р°РІР»РµРЅС‹')
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
      errors.push('РћС‚СЃСѓС‚СЃС‚РІСѓРµС‚ external_id (РёР»Рё id/externalId)')
    } else {
      mappedFields.push('external_id')
      if (i < previewCount) trackFieldMapping(fieldMappings, 'external_id', row)
    }

    if (!row.title && !row.name) {
      warnings.push('РќРµС‚ РїРѕР»СЏ title/name - Р±СѓРґРµС‚ РёСЃРїРѕР»СЊР·РѕРІР°РЅ external_id')
    }

    if (!row.images && !row.image_urls && !row.photos) {
      warnings.push('РР·РѕР±СЂР°Р¶РµРЅРёСЏ РЅРµ РїСЂРµРґРѕСЃС‚Р°РІР»РµРЅС‹')
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
router.post('/import/preview', requireAdminPermission('import.write'), upload.single('file'), async (req: Request, res: Response) => {
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

  const sourceSnapshot = withDbRead((db) => db.feed_sources.find(s => s.id === parsed.data.source_id))
  try {
    const buffer = await getBuffer(req, parsed.data.url)
    const fileName = req.file?.originalname || parsed.data.url || 'feed'
    const ext = guessExt(fileName)
    const rows = parseRows(buffer, ext)

    const source = withDbRead((db) => db.feed_sources.find(s => s.id === parsed.data.source_id))
    const mapping = source?.mapping

    const preview = parsed.data.entity === 'complex'
      ? previewComplexes(rows, mapping)
      : previewProperties(rows)

    res.json({ success: true, data: preview })
  } catch (e) {
    const errorLog = e instanceof Error ? e.message : 'Unknown error'
    withDb((db) => {
      db.import_runs.unshift({
        id: newId(),
        source_id: parsed.data.source_id,
        entity: parsed.data.entity,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: 'failed',
        stats: { inserted: 0, updated: 0, hidden: 0 },
        error_log: errorLog,
        feed_name: sourceSnapshot?.name,
        feed_url: sourceSnapshot?.url || parsed.data.url,
        feed_file: req.file?.originalname,
        action: 'preview',
      })
    })
    res.status(500).json({
      success: false,
      error: 'Preview failed',
      details: errorLog
    })
  }
})

function guessExt(name: string): 'csv' | 'xlsx' | 'xml' | 'json' {
  let lc = name.toLowerCase()
  try {
    lc = new URL(name).pathname.toLowerCase()
  } catch {
    // Keep original string for local filenames.
  }
  if (lc.endsWith('.csv')) return 'csv'
  if (lc.endsWith('.xlsx') || lc.endsWith('.xls')) return 'xlsx'
  if (lc.endsWith('.xml')) return 'xml'
  return 'json'
}

async function getBuffer(req: Request, url?: string): Promise<Buffer> {
  if (req.file?.buffer) return req.file.buffer
  if (url) {
    return fetchFeedBuffer(url)
  }
  throw new Error('No file provided')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function extractTrendAgentBlockLotsCount(block: Record<string, unknown>): number {
  const candidates = [
    block.lots_count,
    block.lot_count,
    block.apartments_count,
    block.apartment_count,
    block.flats_count,
    block.flat_count,
    block.units_count,
    block.unit_count,
    block.offers_count,
    block.offer_count,
    block.count,
    block.total,
  ]

  for (const candidate of candidates) {
    const parsed = numberValue(candidate)
    if (typeof parsed === 'number' && parsed > 0) {
      return Math.trunc(parsed)
    }
  }

  return 0
}

function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function getTrendAgentFetchOptions(url: string): { timeoutMs: number; maxBytes: number } {
  const isApartments = /\/apartments\.json(?:\?|$)/i.test(url)
  const timeoutMs = isApartments
    ? parsePositiveIntEnv(process.env.RW_TRENDAGENT_APARTMENTS_TIMEOUT_MS)
      ?? parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_TIMEOUT_MS)
      ?? TRENDAGENT_APARTMENTS_TIMEOUT_MS
    : parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_TIMEOUT_MS)
      ?? TRENDAGENT_DEFAULT_TIMEOUT_MS
  const maxBytes = isApartments
    ? parsePositiveIntEnv(process.env.RW_TRENDAGENT_APARTMENTS_MAX_BYTES)
      ?? parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_MAX_BYTES)
      ?? TRENDAGENT_APARTMENTS_MAX_BYTES
    : parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_MAX_BYTES)
      ?? TRENDAGENT_DEFAULT_MAX_BYTES
  return { timeoutMs, maxBytes }
}

function isTransientFetchError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('fetch failed')
    || message.includes('host lookup failed')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('eai_again')
    || message.includes('enotfound')
    || message.includes('socket hang up')
    || message.includes('network')
  )
}

function compactAddress(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const rec = asRecord(value)
  if (!rec) return ''
  const parts = ['street', 'house', 'housing', 'building']
    .map((key) => stringValue(rec[key]))
    .filter(Boolean)
  return parts.join(', ')
}

function normalizeTrendAgentImageUrl(value: unknown, baseUrl: string): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('//')) return `https:${raw}`

  let cleaned = raw
  while (cleaned.startsWith('../')) cleaned = cleaned.slice(3)
  while (cleaned.startsWith('./')) cleaned = cleaned.slice(2)

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(cleaned)) {
    return `https://${cleaned}`
  }

  try {
    return new URL(cleaned, baseUrl).toString()
  } catch {
    return null
  }
}

function collectTrendAgentImageUrls(value: unknown, baseUrl: string, out: Set<string>): void {
  if (!value) return
  if (Array.isArray(value)) {
    for (const item of value) collectTrendAgentImageUrls(item, baseUrl, out)
    return
  }
  const record = asRecord(value)
  if (record) {
    if (record.url) collectTrendAgentImageUrls(record.url, baseUrl, out)
    if (record.src) collectTrendAgentImageUrls(record.src, baseUrl, out)
    if (record.path) collectTrendAgentImageUrls(record.path, baseUrl, out)
    return
  }
  const normalized = normalizeTrendAgentImageUrl(value, baseUrl)
  if (normalized) out.add(normalized)
}

function normalizeTrendAgentAboutUrl(sourceUrl: string): string {
  const parsed = new URL(sourceUrl)
  const pathname = parsed.pathname || '/'
  if (pathname.endsWith('/about.json') || pathname.endsWith('about.json')) {
    return parsed.toString()
  }
  const hasFileExt = /\.[a-z0-9]+$/i.test(pathname)
  const isJsonFile = /\.json$/i.test(pathname)
  if (hasFileExt && !isJsonFile) {
    throw new Error('TrendAgent: source URL must point to about.json or a directory containing about.json')
  }
  if (pathname.endsWith('.json')) {
    return parsed.toString()
  }
  parsed.pathname = pathname.endsWith('/') ? `${pathname}about.json` : `${pathname}/about.json`
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function toAbsoluteUrl(baseUrl: string, relativeOrAbsolute: string): string {
  return new URL(relativeOrAbsolute, baseUrl).toString()
}

async function fetchJsonValue(url: string): Promise<unknown> {
  let buffer: Buffer
  const options = getTrendAgentFetchOptions(url)
  const retries = parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_RETRIES) ?? TRENDAGENT_FETCH_RETRIES_DEFAULT
  const retryDelayMs = parsePositiveIntEnv(process.env.RW_TRENDAGENT_FETCH_RETRY_DELAY_MS) ?? TRENDAGENT_FETCH_RETRY_DELAY_MS_DEFAULT
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      buffer = await fetchFeedBuffer(url, options)
      lastError = null
      break
    } catch (error) {
      lastError = error
      const canRetry = attempt < retries && isTransientFetchError(error)
      if (canRetry) {
        const backoffMs = retryDelayMs * (attempt + 1)
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
        continue
      }
      const reason = error instanceof Error ? error.message : 'unknown error'
      throw new Error(`Не удалось загрузить ${url}: ${reason} (timeout=${options.timeoutMs}ms, maxBytes=${options.maxBytes})`)
    }
  }

  if (!buffer!) {
    const reason = lastError instanceof Error ? lastError.message : 'unknown error'
    throw new Error(`Не удалось загрузить ${url}: ${reason} (timeout=${options.timeoutMs}ms, maxBytes=${options.maxBytes})`)
  }

  try {
    return JSON.parse(buffer.toString('utf-8'))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid json'
    throw new Error(`Некорректный JSON в ${url}: ${reason}`)
  }
}

function extractTrendAgentFileMap(aboutUrl: string, aboutPayload: unknown): Record<string, string> {
  const map: Record<string, string> = {}

  const assignEntry = (entry: unknown) => {
    const record = asRecord(entry)
    if (!record) return
    const name = stringValue(record.name).toLowerCase()
    const fileUrl = stringValue(record.url)
    if (!name || !fileUrl) return
    map[name] = toAbsoluteUrl(aboutUrl, fileUrl)
  }

  if (Array.isArray(aboutPayload)) {
    for (const entry of aboutPayload) assignEntry(entry)
  } else {
    const record = asRecord(aboutPayload)
    if (record) {
      const nestedArray = findFirstObjectArray(record)
      if (nestedArray) {
        for (const entry of nestedArray) assignEntry(entry)
      }
      for (const [key, value] of Object.entries(record)) {
        if (typeof value !== 'string') continue
        const normalizedKey = key.toLowerCase()
        if (!normalizedKey) continue
        if (normalizedKey.endsWith('.json') || value.endsWith('.json')) {
          map[normalizedKey.replace(/\.json$/i, '')] = toAbsoluteUrl(aboutUrl, value)
        }
      }
    }
  }

  return map
}

function ensureObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isPlainObject) as Record<string, unknown>[]
  const found = findFirstObjectArray(value)
  return found || []
}

function getFreshTrendAgentCacheEntry(cacheKey: string): { loadedAt: number; dataset: TrendAgentDataset } | null {
  const entry = trendAgentDatasetCache.get(cacheKey)
  if (!entry) return null
  if (Date.now() - entry.loadedAt >= TRENDAGENT_CACHE_TTL_MS) return null
  return entry
}

async function loadTrendAgentDataset(sourceUrl: string, forceRefresh = false, mode: TrendAgentDatasetMode = 'full'): Promise<TrendAgentDataset> {
  const sourceKey = sourceUrl.trim()
  const cacheKey = `${sourceKey}::${mode}`
  const cached = getFreshTrendAgentCacheEntry(cacheKey)
  if (!forceRefresh && cached) {
    return cached.dataset
  }

  const reusedCache = !forceRefresh
    ? getFreshTrendAgentCacheEntry(`${sourceKey}::full`) || getFreshTrendAgentCacheEntry(`${sourceKey}::list`)
    : null

  const aboutUrl = reusedCache?.dataset.aboutUrl || normalizeTrendAgentAboutUrl(sourceUrl)
  const files = reusedCache?.dataset.files || extractTrendAgentFileMap(aboutUrl, await fetchJsonValue(aboutUrl))

  const isFullMode = mode === 'full'
  const isComplexMode = mode === 'complex'
  const required = isFullMode ? ['apartments', 'blocks'] : ['blocks']
  for (const key of required) {
    if (!files[key]) {
      throw new Error(`TrendAgent feed is missing required file "${key}.json" in about.json`)
    }
  }

  const names = isFullMode
    ? (['apartments', 'blocks', 'buildings', 'builders', 'regions', 'subways', 'rooms', 'finishings', 'buildingtypes'] as const)
    : isComplexMode
      ? (['blocks', 'buildings', 'builders', 'regions', 'subways', 'buildingtypes'] as const)
      : (['blocks', 'regions', 'builders'] as const)
  const loaded = await Promise.all(
    names.map(async (name) => {
      const fileUrl = files[name]
      if (!fileUrl) return [name, [] as Record<string, unknown>[]] as const
      const payload = await fetchJsonValue(fileUrl)
      return [name, ensureObjectArray(payload)] as const
    }),
  )

  const entries = Object.fromEntries(loaded) as Partial<Record<(typeof names)[number], Record<string, unknown>[]>>
  const dataset: TrendAgentDataset = {
    sourceUrl,
    aboutUrl,
    files,
    apartments: isFullMode ? (entries.apartments || []) : [],
    blocks: entries.blocks || [],
    buildings: isFullMode || isComplexMode ? (entries.buildings || []) : [],
    builders: entries.builders || [],
    regions: entries.regions || [],
    subways: isFullMode || isComplexMode ? (entries.subways || []) : [],
    rooms: isFullMode ? (entries.rooms || []) : [],
    finishings: isFullMode ? (entries.finishings || []) : [],
    buildingtypes: isFullMode || isComplexMode ? (entries.buildingtypes || []) : [],
  }

  trendAgentDatasetCache.set(cacheKey, { loadedAt: Date.now(), dataset })
  return dataset
}

function buildTrendAgentComplexOptions(dataset: TrendAgentDataset): TrendAgentComplexOption[] {
  const hasApartmentRows = dataset.apartments.length > 0
  const blocksById = new Map<string, Record<string, unknown>>(
    dataset.blocks.map((block) => [stringValue(block._id), block] as const).filter(([id]) => Boolean(id)),
  )
  const regionsById = new Map<string, string>(
    dataset.regions
      .map((region) => [stringValue(region._id), stringValue(region.name)] as const)
      .filter(([id]) => Boolean(id)),
  )
  const buildersById = new Map<string, string>()
  for (const builder of dataset.builders) {
    const name = stringValue(builder.name)
    const id = stringValue(builder._id)
    if (id && name) buildersById.set(id, name)
    if (builder.crm_id !== undefined && builder.crm_id !== null && name) {
      buildersById.set(String(builder.crm_id), name)
    }
  }

  const buckets = new Map<
    string,
    {
      count: number
      minPrice?: number
      maxPrice?: number
      district?: string
      address?: string
      title?: string
      developerCounts: Map<string, number>
    }
  >()

  for (const [blockId, block] of blocksById.entries()) {
    const district = regionsById.get(stringValue(block.district))
    const address = compactAddress(block.address)
    const title = stringValue(block.name) || blockId
    const builderKey =
      stringValue(block.builder)
      || stringValue(block.builder_id)
      || stringValue(block.builderId)
      || stringValue(block.block_builder)
    const builderName =
      stringValue(block.builder_name)
      || stringValue(block.block_builder_name)
      || (builderKey ? buildersById.get(builderKey) : '')
    const developerCounts = new Map<string, number>()
    if (builderName) developerCounts.set(builderName, 1)
    const fallbackLotsCount = hasApartmentRows ? 0 : extractTrendAgentBlockLotsCount(block)
    buckets.set(blockId, {
      count: fallbackLotsCount,
      district: district || undefined,
      address: address || undefined,
      title,
      developerCounts,
    })
  }

  for (const row of dataset.apartments) {
    const blockId = stringValue(row.block_id)
    if (!blockId) continue
    const bucket = buckets.get(blockId) || {
      count: 0,
      developerCounts: new Map<string, number>(),
    }
    bucket.count += 1
    const price = numberValue(row.price)
    if (typeof price === 'number') {
      bucket.minPrice = typeof bucket.minPrice === 'number' ? Math.min(bucket.minPrice, price) : price
      bucket.maxPrice = typeof bucket.maxPrice === 'number' ? Math.max(bucket.maxPrice, price) : price
    }
    const district = stringValue(row.block_district_name)
    if (district && !bucket.district) bucket.district = district
    const address = compactAddress(row.block_address)
    if (address && !bucket.address) bucket.address = address
    const title = stringValue(row.block_name)
    if (title && !bucket.title) bucket.title = title
    const developer = stringValue(row.block_builder_name)
    if (developer) {
      bucket.developerCounts.set(developer, (bucket.developerCounts.get(developer) || 0) + 1)
    }
    buckets.set(blockId, bucket)
  }

  const options: TrendAgentComplexOption[] = []
  for (const [blockId, bucket] of buckets.entries()) {
    const block = blocksById.get(blockId)
    const blockDistrict = block ? regionsById.get(stringValue(block.district)) : undefined
    const district = bucket.district || blockDistrict || undefined
    const address = bucket.address || (block ? compactAddress(block.address) : '') || undefined
    const title = bucket.title || (block ? stringValue(block.name) : '') || blockId
    const developer = [...bucket.developerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

    options.push({
      block_id: blockId,
      title,
      district,
      developer: developer || undefined,
      address,
      lots_count: bucket.count,
      price_from: bucket.minPrice,
      price_to: bucket.maxPrice,
    })
  }

  return options.sort((a, b) => {
    if (b.lots_count !== a.lots_count) return b.lots_count - a.lots_count
    return a.title.localeCompare(b.title, 'ru')
  })
}

function parseTrendAgentBedrooms(roomCode: unknown, roomName: string): { bedrooms: number; isEuroflat: boolean } {
  const code = numberValue(roomCode)
  if (typeof code === 'number') {
    const euroMap: Record<number, number> = { 22: 2, 23: 3, 24: 4, 25: 5 }
    if (euroMap[Math.trunc(code)]) {
      return { bedrooms: euroMap[Math.trunc(code)], isEuroflat: true }
    }
  }
  const normalized = roomName.toLowerCase()
  const match = normalized.match(/(\d+)/)
  const bedrooms = match ? Math.max(0, Number(match[1])) : 1
  return { bedrooms, isEuroflat: /[Рµe]/i.test(normalized) }
}

function isTrendAgentManifestRows(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false
  const hasApartments = rows.some(
    (row) => stringValue(row.name).toLowerCase() === 'apartments' && stringValue(row.url).toLowerCase().includes('apartments'),
  )
  const allHaveManifestShape = rows.every((row) => Boolean(stringValue(row.name)) && Boolean(stringValue(row.url)))
  return hasApartments && allHaveManifestShape
}

function buildTrendAgentComplexImportRows(dataset: TrendAgentDataset, selectedBlockIds: Set<string>): Record<string, unknown>[] {
  const blockById = new Map<string, Record<string, unknown>>(
    dataset.blocks.map((item) => [stringValue(item._id), item] as const).filter(([id]) => Boolean(id)),
  )
  const regionNameById = new Map<string, string>(
    dataset.regions.map((item) => [stringValue(item._id), stringValue(item.name)] as const).filter(([id]) => Boolean(id)),
  )
  const buildingTypeNameById = new Map<string, string>()
  for (const row of dataset.buildingtypes) {
    const id = stringValue(row._id)
    const name = stringValue(row.name)
    if (id && name) buildingTypeNameById.set(id, name)
    if (row.crm_id !== undefined && row.crm_id !== null && name) {
      buildingTypeNameById.set(String(row.crm_id), name)
    }
  }
  const builderNameById = new Map<string, string>()
  for (const row of dataset.builders) {
    const id = stringValue(row._id)
    const name = stringValue(row.name)
    if (id && name) builderNameById.set(id, name)
    if (row.crm_id !== undefined && row.crm_id !== null && name) {
      builderNameById.set(String(row.crm_id), name)
    }
  }
  const subwayNameById = new Map<string, string>()
  for (const row of dataset.subways) {
    const id = stringValue(row._id)
    const name = stringValue(row.name)
    if (id && name) subwayNameById.set(id, name)
    if (row.crm_id !== undefined && row.crm_id !== null && name) {
      subwayNameById.set(String(row.crm_id), name)
    }
  }

  const buildingsByBlockId = new Map<string, Record<string, unknown>[]>()
  for (const row of dataset.buildings) {
    const blockId =
      stringValue(row.block_id)
      || stringValue(row.block)
      || stringValue(row.blockId)
      || stringValue(row.complex_id)
      || stringValue(row.block_external_id)
    if (!blockId) continue
    const bucket = buildingsByBlockId.get(blockId)
    if (bucket) bucket.push(row)
    else buildingsByBlockId.set(blockId, [row])
  }

  const hasNonEmptyValue = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0
    const record = asRecord(value)
    if (record) return Object.keys(record).length > 0
    const str = stringValue(value)
    if (!str) return false
    const normalized = str.toLowerCase()
    if (['0', 'false', 'no', 'none', 'null', 'нет'].includes(normalized)) return false
    return true
  }

  const collectSubwayNames = (value: unknown): string[] => {
    const names = new Set<string>()
    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const item of node) visit(item)
        return
      }
      const record = asRecord(node)
      if (record) {
        const id =
          stringValue(record.subway_id)
          || stringValue(record.subwayId)
          || stringValue(record.id)
          || stringValue(record._id)
        const explicitName = stringValue(record.name)
        const resolved = explicitName || (id ? subwayNameById.get(id) || '' : '')
        if (resolved) names.add(resolved)
        return
      }
      const raw = stringValue(node)
      if (!raw) return
      names.add(subwayNameById.get(raw) || raw)
    }
    visit(value)
    return [...names]
  }

  const rows: Record<string, unknown>[] = []
  for (const blockId of selectedBlockIds) {
    const block = blockById.get(blockId)
    if (!block) continue
    const buildings = buildingsByBlockId.get(blockId) || []

    const queueValues = buildings
      .map((row) => numberValue(row.queue))
      .filter((value): value is number => typeof value === 'number' && value > 0)
    const queueMin = queueValues.length > 0 ? Math.min(...queueValues) : undefined

    const deadlines = buildings
      .map((row) => stringValue(row.deadline))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    const deadline = deadlines[0] || stringValue(block.deadline) || undefined

    const blockBuildingTypeId = stringValue(block.building_type)
    const buildingBuildingTypeId = buildings
      .map((row) => stringValue(row.building_type))
      .find(Boolean)
    const buildingTypeId = blockBuildingTypeId || buildingBuildingTypeId || ''
    const buildingType = buildingTypeNameById.get(buildingTypeId) || buildingTypeId || undefined

    const builderKey =
      stringValue(block.builder)
      || stringValue(block.builder_id)
      || stringValue(block.builderId)
      || stringValue(block.block_builder)
    const developer =
      stringValue(block.builder_name)
      || stringValue(block.block_builder_name)
      || (builderKey ? builderNameById.get(builderKey) || '' : '')
      || undefined

    const district =
      regionNameById.get(stringValue(block.district))
      || stringValue(block.district_name)
      || undefined

    const subwayNames = collectSubwayNames(block.subway)
    const hasMortgage = hasNonEmptyValue(block.mortgages) || buildings.some((row) => hasNonEmptyValue(row.mortgages))

    const imagesSet = new Set<string>()
    collectTrendAgentImageUrls(block.renderer, dataset.sourceUrl, imagesSet)
    collectTrendAgentImageUrls(block.plan, dataset.sourceUrl, imagesSet)
    collectTrendAgentImageUrls(block.progress, dataset.sourceUrl, imagesSet)
    const images = [...imagesSet]

    rows.push({
      ...block,
      external_id: blockId,
      title: stringValue(block.name) || blockId,
      developer,
      block_builder_name: developer,
      district,
      block_district_name: district,
      metro: subwayNames.length > 0 ? subwayNames : undefined,
      block_subway_name: subwayNames.length > 0 ? subwayNames : undefined,
      images,
      description: stringValue(block.description) || undefined,
      block_description: stringValue(block.description) || undefined,
      address: compactAddress(block.address) || undefined,
      block_address: compactAddress(block.address) || undefined,
      handover_date: deadline,
      building_deadline: deadline,
      queue_min: queueMin,
      building_queue: queueMin,
      building_type_name: buildingType,
      building_type: buildingType,
      mortgage_available: hasMortgage ? true : undefined,
      building_mortgage: hasMortgage ? true : undefined,
      geometry: block.geometry,
      block_geometry: block.geometry,
      category: 'newbuild',
      deal_type: 'sale',
    })
  }
  return rows
}

function buildTrendAgentImportRows(dataset: TrendAgentDataset, selectedBlockIds: Set<string>): Record<string, unknown>[] {
  const roomNameByCode = new Map<string, string>()
  for (const room of dataset.rooms) {
    const name = stringValue(room.name)
    const crmId = room.crm_id
    const id = stringValue(room._id)
    if (crmId !== undefined && crmId !== null) roomNameByCode.set(String(crmId), name)
    if (id) roomNameByCode.set(id, name)
  }
  const regionNameById = new Map<string, string>(
    dataset.regions.map((item) => [stringValue(item._id), stringValue(item.name)] as const).filter(([id]) => Boolean(id)),
  )
  const subwayNameById = new Map<string, string>()
  for (const subway of dataset.subways) {
    const name = stringValue(subway.name)
    const id = stringValue(subway._id)
    if (id && name) subwayNameById.set(id, name)
    if (subway.crm_id !== undefined && subway.crm_id !== null && name) {
      subwayNameById.set(String(subway.crm_id), name)
    }
  }
  const builderNameById = new Map<string, string>()
  for (const builder of dataset.builders) {
    const name = stringValue(builder.name)
    const id = stringValue(builder._id)
    if (id && name) builderNameById.set(id, name)
    if (builder.crm_id !== undefined && builder.crm_id !== null && name) {
      builderNameById.set(String(builder.crm_id), name)
    }
  }
  const finishingNameById = new Map<string, string>(
    dataset.finishings.map((item) => [stringValue(item._id), stringValue(item.name)] as const).filter(([id]) => Boolean(id)),
  )
  const buildingTypeNameById = new Map<string, string>(
    dataset.buildingtypes.map((item) => [stringValue(item._id), stringValue(item.name)] as const).filter(([id]) => Boolean(id)),
  )
  const buildingById = new Map<string, Record<string, unknown>>()
  const buildingByName = new Map<string, Record<string, unknown>>()
  for (const building of dataset.buildings) {
    const id = stringValue(building._id)
    if (id) buildingById.set(id, building)
    if (building.crm_id !== undefined && building.crm_id !== null) {
      buildingById.set(String(building.crm_id), building)
    }
    const name = stringValue(building.name).toLowerCase()
    if (name && !buildingByName.has(name)) buildingByName.set(name, building)
  }
  const blockById = new Map<string, Record<string, unknown>>(
    dataset.blocks.map((item) => [stringValue(item._id), item] as const).filter(([id]) => Boolean(id)),
  )

  const resolveBuildingByApartment = (apt: Record<string, unknown>): Record<string, unknown> | undefined => {
    const key =
      stringValue(apt.building)
      || stringValue(apt.building_id)
      || stringValue(apt.buildingId)
      || stringValue(apt.building_uid)
      || stringValue(apt.building_crm_id)
    if (key && buildingById.has(key)) return buildingById.get(key)
    const name = stringValue(apt.building_name).toLowerCase()
    if (name && buildingByName.has(name)) return buildingByName.get(name)
    return undefined
  }

  const hasNonEmptyValue = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0
    const record = asRecord(value)
    if (record) return Object.keys(record).length > 0
    const str = stringValue(value)
    if (!str) return false
    const normalized = str.toLowerCase()
    if (['0', 'false', 'no', 'none', 'null', 'нет'].includes(normalized)) return false
    return true
  }

  const collectSubwayNames = (value: unknown): string[] => {
    const names = new Set<string>()
    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const item of node) visit(item)
        return
      }
      const record = asRecord(node)
      if (record) {
        const id =
          stringValue(record.subway_id)
          || stringValue(record.subwayId)
          || stringValue(record.id)
          || stringValue(record._id)
        const explicitName = stringValue(record.name)
        const resolvedName = explicitName || (id ? subwayNameById.get(id) || '' : '')
        if (resolvedName) names.add(resolvedName)
        return
      }
      const raw = stringValue(node)
      if (!raw) return
      names.add(subwayNameById.get(raw) || raw)
    }
    visit(value)
    return [...names]
  }

  const rows: Record<string, unknown>[] = []
  for (const apt of dataset.apartments) {
    const blockId = stringValue(apt.block_id)
    if (!blockId || !selectedBlockIds.has(blockId)) continue
    const block = blockById.get(blockId)
    const building = resolveBuildingByApartment(apt)

    const roomCode = apt.room
    const roomName = roomNameByCode.get(String(roomCode ?? '')) || ''
    const parsedBedrooms = parseTrendAgentBedrooms(roomCode, roomName)
    const blockName = stringValue(apt.block_name) || (block ? stringValue(block.name) : '') || blockId
    const title =
      parsedBedrooms.bedrooms === 0
        ? `РЎС‚СѓРґРёСЏ РІ ${blockName}`
        : parsedBedrooms.isEuroflat
          ? `${parsedBedrooms.bedrooms}Р• РІ ${blockName}`
          : `${parsedBedrooms.bedrooms}-РєРѕРјРЅ. РІ ${blockName}`

    const finishingId = stringValue(apt.finishing)
    const buildingTypeId = stringValue(apt.building_type) || stringValue(building?.building_type)
    const buildingDeadline = stringValue(building?.deadline) || stringValue(apt.building_deadline)
    const buildingQueue = numberValue(building?.queue) ?? numberValue(apt.building_queue)
    const blockDistrictName =
      stringValue(apt.block_district_name)
      || (block ? regionNameById.get(stringValue(block.district)) || '' : '')
    const blockBuilderKey =
      block
        ? (
            stringValue(block.builder)
            || stringValue(block.builder_id)
            || stringValue(block.builderId)
            || stringValue(block.block_builder)
          )
        : ''
    const blockBuilderName =
      stringValue(apt.block_builder_name)
      || (block ? stringValue(block.builder_name) || stringValue(block.block_builder_name) : '')
      || (blockBuilderKey ? builderNameById.get(blockBuilderKey) || '' : '')
    const aptSubwayNames = collectSubwayNames(apt.block_subway_name)
    const subwayNames = aptSubwayNames.length > 0 ? aptSubwayNames : collectSubwayNames(block?.subway)
    const hasMortgagePrograms = hasNonEmptyValue(building?.mortgages ?? apt.building_mortgage ?? apt.mortgage)
    const imagesSet = new Set<string>()
    collectTrendAgentImageUrls(apt.plan, dataset.sourceUrl, imagesSet)
    collectTrendAgentImageUrls(apt.block_renderer, dataset.sourceUrl, imagesSet)
    if (block) {
      collectTrendAgentImageUrls(block.renderer, dataset.sourceUrl, imagesSet)
      collectTrendAgentImageUrls(block.plan, dataset.sourceUrl, imagesSet)
      collectTrendAgentImageUrls(block.progress, dataset.sourceUrl, imagesSet)
    }
    const images = [...imagesSet]

    rows.push({
      ...apt,
      external_id: stringValue(apt._id),
      complex_external_id: blockId,
      title,
      bedrooms: parsedBedrooms.bedrooms,
      is_euroflat: parsedBedrooms.isEuroflat,
      lot_number: stringValue(apt.number),
      area_living: numberValue(apt.area_rooms_total),
      area_given: numberValue(apt.area_given),
      floors_total: numberValue(apt.floors),
      old_price: numberValue(apt.price_base),
      renovation: finishingNameById.get(finishingId) || finishingId || undefined,
      building_type_name: buildingTypeNameById.get(buildingTypeId) || buildingTypeId || undefined,
      building_type: buildingTypeNameById.get(buildingTypeId) || buildingTypeId || undefined,
      building_section: stringValue(apt.building_name) || stringValue(building?.name) || undefined,
      building_queue: typeof buildingQueue === 'number' ? buildingQueue : undefined,
      building_deadline: buildingDeadline || undefined,
      building_mortgage: hasMortgagePrograms ? true : undefined,
      block_builder_name: blockBuilderName || undefined,
      block_district_name: blockDistrictName || undefined,
      district: blockDistrictName || undefined,
      block_subway_name: subwayNames.length > 0 ? subwayNames : undefined,
      block_geometry: block?.geometry,
      block_description: block ? stringValue(block.description) : undefined,
      block_address: block ? compactAddress(block.address) : compactAddress(apt.block_address),
      images,
      deal_type: 'sale',
      category: 'newbuild',
    })
  }
  return rows
}

function parseRows(buffer: Buffer, ext: 'csv' | 'xlsx' | 'xml' | 'json'): Record<string, unknown>[] {
  if (ext === 'csv') {
    const raw = buffer.toString('utf-8')
    const rows = parseCsv(raw, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]
    assertFeedRowLimit(rows.length)
    return rows
  }
  if (ext === 'xlsx') {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    const sheet = wb.Sheets[sheetName]
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    const rows = json as Record<string, unknown>[]
    assertFeedRowLimit(rows.length)
    return rows
  }
  if (ext === 'xml') {
    const parser = new XMLParser({ ignoreAttributes: false })
    const obj = parser.parse(buffer.toString('utf-8'))
    const arr = findFirstObjectArray(obj)
    const rows = arr || []
    assertFeedRowLimit(rows.length)
    // Normalize Yandex Realty XML format
    return rows.map(row => normalizeYandexRealty(row))
  }

  const obj = JSON.parse(buffer.toString('utf-8'))
  if (Array.isArray(obj)) {
    const rows = obj.filter(isPlainObject) as Record<string, unknown>[]
    if (isTrendAgentManifestRows(rows)) {
      throw new Error('РћР±РЅР°СЂСѓР¶РµРЅ TrendAgent about.json. РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±Р»РѕРє РІС‹Р±РѕСЂР° Р–Рљ РІ Р°РґРјРёРЅРєРµ Рё РёРјРїРѕСЂС‚ РІС‹Р±СЂР°РЅРЅС‹С… РєРѕРјРїР»РµРєСЃРѕРІ.')
    }
    assertFeedRowLimit(rows.length)
    return rows
  }
  const arr = findFirstObjectArray(obj)
  const rows = arr || []
  if (isTrendAgentManifestRows(rows)) {
    throw new Error('РћР±РЅР°СЂСѓР¶РµРЅ TrendAgent about.json. РСЃРїРѕР»СЊР·СѓР№С‚Рµ Р±Р»РѕРє РІС‹Р±РѕСЂР° Р–Рљ РІ Р°РґРјРёРЅРєРµ Рё РёРјРїРѕСЂС‚ РІС‹Р±СЂР°РЅРЅС‹С… РєРѕРјРїР»РµРєСЃРѕРІ.')
  }
  assertFeedRowLimit(rows.length)
  return rows
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArrayOfObjects(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && (value.length === 0 || value.every(isPlainObject))
}

function findFirstObjectArray(obj: unknown): Record<string, unknown>[] | null {
  if (!obj || typeof obj !== 'object') return null
  if (isArrayOfObjects(obj)) return obj
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = findFirstObjectArray(v)
    if (found) return found
  }
  return null
}

export default router

