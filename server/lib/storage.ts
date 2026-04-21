import fs from 'fs'
import path from 'path'
import type { DbShape } from '../../shared/types.js'
import { DATA_DIR } from './paths.js'
import {
  createStateRepository,
  readLocalStateFiles,
  type StateRepository,
  type StorageDriver,
} from './state-repository.js'

const DB_FILE = path.join(DATA_DIR, 'db.json')
const PUBLISHED_DB_FILE = path.join(DATA_DIR, 'db.published.json')

type PublishSnapshot = Omit<DbShape, 'admin_users' | 'leads' | 'audit_logs'> & {
  admin_users: []
  leads: []
  audit_logs: []
}

function toPublishSnapshot(db: DbShape): PublishSnapshot {
  return {
    ...db,
    admin_users: [],
    leads: [],
    audit_logs: [],
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
}

const LEGACY_BUILT_IN_LANDING_FEATURE_KEYS = new Set([
  'panoramic',
  'concierge',
  'market',
  'restaurant',
  'beauty',
  'lounge',
  'cafe',
  'coworking',
  'kids',
  'parking',
  'yard',
  'pet',
])

function normalizePresetKey(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function purgeLegacyBuiltInLandingFeatures(db: DbShape): boolean {
  let changed = false

  if (Array.isArray(db.hidden_landing_feature_preset_keys)) {
    const nextHidden = db.hidden_landing_feature_preset_keys.filter(
      (key) => !LEGACY_BUILT_IN_LANDING_FEATURE_KEYS.has(normalizePresetKey(key)),
    )
    if (nextHidden.length !== db.hidden_landing_feature_preset_keys.length) {
      db.hidden_landing_feature_preset_keys = nextHidden
      changed = true
    }
  }

  for (const complex of db.complexes) {
    const landing = complex.landing
    if (!landing || !Array.isArray(landing.feature_ticker) || !landing.feature_ticker.length) continue

    const nextTicker = landing.feature_ticker.filter((feature) => {
      const key = normalizePresetKey((feature as { preset_key?: unknown })?.preset_key)
      return !LEGACY_BUILT_IN_LANDING_FEATURE_KEYS.has(key)
    })

    if (nextTicker.length !== landing.feature_ticker.length) {
      landing.feature_ticker = nextTicker
      complex.updated_at = nowIso()
      changed = true
    }
  }

  return changed
}

function createEmptyDbState(): DbShape {
  const now = nowIso()
  return {
    home: {
      hero: {
        title: '',
        subtitle: '',
        address: '',
        phone: '',
        slogan_options: [],
      },
      advantages: [],
      pricing: [],
      steps: [],
      mission: {
        title: '',
        text: '',
      },
      team: {
        title: '',
        founders: [],
        links: [],
      },
      reviews: [],
      partner: {
        title: '',
        text: '',
      },
      featured: {
        complexes: [],
        properties: [],
        collections: [],
      },
      maps: {
        yandex_maps_api_key: '',
      },
      updated_at: now,
    },
    feed_sources: [],
    complexes: [],
    properties: [],
    collections: [],
    admin_users: [],
    leads: [],
    import_runs: [],
    landing_feature_presets: [],
    hidden_landing_feature_preset_keys: [],
    audit_logs: [],
  }
}

let repository: StateRepository | null = null
let initialized = false
let activeStorageDriver: StorageDriver | 'unknown' = 'unknown'

let draftDbCache: DbShape | null = null
let publishedDbCache: DbShape | null = null
let draftUpdatedAt: string | undefined
let publishedAt: string | undefined
let pendingPublishedChanges = false

let persistQueue: Promise<void> = Promise.resolve()
let persistPending: {
  request: PersistRequest
  draft: DbShape
  published: DbShape
} | null = null
let persistWorkerRunning = false
let lastPersistError: string | null = null
let lastPersistErrorAt: string | undefined
let lastPersistSuccessAt: string | undefined

type PersistRequest = {
  persistDraft: boolean
  persistPublished: boolean
}

type WithDbOptions = {
  persist?: boolean
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function assertInitialized(): void {
  if (!initialized) {
    throw new Error('Storage is not initialized. Call initializeStorage() before using storage API.')
  }
}

function startPersistWorker(): void {
  if (persistWorkerRunning) return

  persistWorkerRunning = true
  persistQueue = (async () => {
    while (persistPending) {
      const task = persistPending
      persistPending = null

      if (!repository) continue

      try {
        const meta = await repository.saveState(task.draft, task.published, task.request)
        if (meta.draftUpdatedAt) draftUpdatedAt = meta.draftUpdatedAt
        if (meta.publishedAt) publishedAt = meta.publishedAt
        lastPersistError = null
        lastPersistErrorAt = undefined
        lastPersistSuccessAt = new Date().toISOString()
      } catch (error) {
        console.error('[storage] Persist error:', error)
        lastPersistError = error instanceof Error ? error.message : String(error)
        lastPersistErrorAt = new Date().toISOString()
      }
    }
  })().finally(() => {
    persistWorkerRunning = false
    if (persistPending) {
      startPersistWorker()
    }
  })
}

function queuePersist(request: PersistRequest): void {
  if (!repository || !draftDbCache || !publishedDbCache) return
  if (!request.persistDraft && !request.persistPublished) return

  const nextRequest = persistPending
    ? {
        persistDraft: persistPending.request.persistDraft || request.persistDraft,
        persistPublished: persistPending.request.persistPublished || request.persistPublished,
      }
    : request

  console.log(
    `[storage] Queue persist: draft=${draftDbCache.import_runs?.length || 0} runs, persistDraft=${nextRequest.persistDraft}, persistPublished=${nextRequest.persistPublished}`,
  )

  persistPending = {
    request: nextRequest,
    // Clone only parts that will actually be persisted.
    draft: nextRequest.persistDraft ? deepClone(draftDbCache) : draftDbCache,
    published: nextRequest.persistPublished ? deepClone(publishedDbCache) : publishedDbCache,
  }

  startPersistWorker()
}

function setDraft(db: DbShape): void {
  draftDbCache = db
  draftUpdatedAt = new Date().toISOString()
}

function setPublished(db: DbShape): void {
  publishedDbCache = db
  publishedAt = new Date().toISOString()
}

export async function initializeStorage(): Promise<void> {
  if (initialized) return

  const repo = createStateRepository()
  await repo.initialize()
  activeStorageDriver = repo.driver

  const loaded = await repo.loadState()
  repository = repo
  draftDbCache = loaded.draft
  publishedDbCache = loaded.published
  draftUpdatedAt = loaded.draftUpdatedAt
  publishedAt = loaded.publishedAt
  lastPersistError = null
  lastPersistErrorAt = undefined
  lastPersistSuccessAt = undefined

  console.log(
    `[storage] Loaded state from ${repo.driver}: draft.import_runs=${draftDbCache?.import_runs?.length || 0}, published.import_runs=${publishedDbCache?.import_runs?.length || 0}`,
  )

  // One-time bootstrap from local JSON into PostgreSQL is opt-in only.
  // This prevents accidental data replacement on deploy.
  const bootstrapFromLocal = parseBooleanEnv(process.env.RW_PG_BOOTSTRAP_FROM_LOCAL) === true
  if (repo.driver === 'postgres' && !draftDbCache && bootstrapFromLocal) {
    const local = readLocalStateFiles()
    if (local.draft) {
      draftDbCache = local.draft
      publishedDbCache = local.published || toPublishSnapshot(local.draft)
      const meta = await repo.saveState(draftDbCache, publishedDbCache)
      draftUpdatedAt = meta.draftUpdatedAt || local.draftUpdatedAt
      publishedAt = meta.publishedAt || local.publishedAt
      console.log('[storage] Bootstrapped PostgreSQL state from local JSON files')
    }
  } else if (repo.driver === 'postgres' && !draftDbCache && !bootstrapFromLocal) {
    console.log(
      '[storage] PostgreSQL is empty. Local bootstrap is disabled (set RW_PG_BOOTSTRAP_FROM_LOCAL=true for one-time import).',
    )
  }

  if (!draftDbCache && publishedDbCache) {
    const restoredDraft = deepClone(publishedDbCache)
    if (!Array.isArray(restoredDraft.admin_users)) restoredDraft.admin_users = []
    if (!Array.isArray(restoredDraft.leads)) restoredDraft.leads = []
    if (!Array.isArray(restoredDraft.import_runs)) restoredDraft.import_runs = []
    if (!Array.isArray(restoredDraft.audit_logs)) restoredDraft.audit_logs = []
    draftDbCache = restoredDraft
    const meta = await repo.saveState(draftDbCache, publishedDbCache, {
      persistDraft: true,
      persistPublished: false,
    })
    draftUpdatedAt = meta.draftUpdatedAt || draftUpdatedAt || nowIso()
    console.warn('[storage] Restored missing draft state from published snapshot')
  }

  if (!draftDbCache) {
    const empty = createEmptyDbState()
    draftDbCache = empty
    publishedDbCache = toPublishSnapshot(empty)
    const meta = await repo.saveState(draftDbCache, publishedDbCache)
    draftUpdatedAt = meta.draftUpdatedAt || nowIso()
    publishedAt = meta.publishedAt || nowIso()
    console.log('[storage] Initialized empty storage state')
  } else if (!publishedDbCache) {
    publishedDbCache = toPublishSnapshot(draftDbCache)
    const meta = await repo.saveState(draftDbCache, publishedDbCache, {
      persistDraft: false,
      persistPublished: true,
    })
    publishedAt = meta.publishedAt || publishedAt || nowIso()
    console.log('[storage] Created missing published snapshot from draft state')
  }

  if (draftDbCache && publishedDbCache) {
    const draftChanged = purgeLegacyBuiltInLandingFeatures(draftDbCache)
    const publishedChanged = purgeLegacyBuiltInLandingFeatures(publishedDbCache)
    if (draftChanged || publishedChanged) {
      const meta = await repo.saveState(draftDbCache, publishedDbCache)
      draftUpdatedAt = meta.draftUpdatedAt || draftUpdatedAt || nowIso()
      publishedAt = meta.publishedAt || publishedAt || nowIso()
      console.log('[storage] Removed legacy built-in landing feature presets from state')
    }
  }

  if (draftDbCache && publishedDbCache) {
    try {
      pendingPublishedChanges =
        JSON.stringify(toPublishSnapshot(draftDbCache))
        !== JSON.stringify(toPublishSnapshot(publishedDbCache))
    } catch {
      pendingPublishedChanges = true
    }
  } else {
    pendingPublishedChanges = false
  }

  initialized = true
}

export async function flushStorage(): Promise<void> {
  await persistQueue
  if (lastPersistError) {
    const suffix = lastPersistErrorAt ? ` at ${lastPersistErrorAt}` : ''
    throw new Error(`Storage persist failed${suffix}: ${lastPersistError}`)
  }
}

export async function closeStorage(): Promise<void> {
  if (!initialized) return
  await flushStorage()
  if (repository) {
    await repository.close()
  }
  repository = null
  activeStorageDriver = 'unknown'
  pendingPublishedChanges = false
  initialized = false
}

export function getStorageDriver(): StorageDriver | 'unknown' {
  return activeStorageDriver
}

export function getDbFilePath(): string {
  return DB_FILE
}

export function getPublishedDbFilePath(): string {
  return PUBLISHED_DB_FILE
}

export function dbExists(): boolean {
  if (!initialized) return false
  return Boolean(draftDbCache)
}

export function publishedDbExists(): boolean {
  if (!initialized) return false
  return Boolean(publishedDbCache)
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readDb(): DbShape {
  assertInitialized()
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  return deepClone(draftDbCache)
}

export function writeDb(db: DbShape): void {
  assertInitialized()
  const hadPublished = Boolean(publishedDbCache)
  setDraft(db)
  if (!publishedDbCache) {
    setPublished(toPublishSnapshot(db))
    pendingPublishedChanges = false
  } else {
    pendingPublishedChanges = true
  }
  queuePersist({ persistDraft: true, persistPublished: !hadPublished })
}

export function ensurePublishedDb(): void {
  assertInitialized()
  if (publishedDbCache) return
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  setPublished(toPublishSnapshot(draftDbCache))
  pendingPublishedChanges = false
  queuePersist({ persistDraft: false, persistPublished: true })
}

export function readPublishedDb(): DbShape {
  ensurePublishedDb()
  if (!publishedDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  return deepClone(publishedDbCache)
}

export function writePublishedDb(db: DbShape): void {
  assertInitialized()
  const hadDraft = Boolean(draftDbCache)
  setPublished(toPublishSnapshot(db))
  if (!draftDbCache) {
    setDraft(db)
  }
  pendingPublishedChanges = false
  queuePersist({ persistDraft: !hadDraft, persistPublished: true })
}

export function publishDraft(): { published_at?: string } {
  assertInitialized()
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  setPublished(toPublishSnapshot(draftDbCache))
  pendingPublishedChanges = false
  queuePersist({ persistDraft: false, persistPublished: true })
  return { published_at: publishedAt }
}

export function hasPendingPublishedChanges(): boolean {
  return pendingPublishedChanges
}

export function getPublishStatus(): {
  has_pending_changes: boolean
  draft_updated_at?: string
  published_at?: string
  storage: {
    driver: StorageDriver | 'unknown'
    last_persist_error: string | null
    last_persist_error_at?: string
    last_persist_success_at?: string
  }
} {
  return {
    has_pending_changes: hasPendingPublishedChanges(),
    draft_updated_at: draftUpdatedAt,
    published_at: publishedAt,
    storage: {
      driver: activeStorageDriver,
      last_persist_error: lastPersistError,
      last_persist_error_at: lastPersistErrorAt,
      last_persist_success_at: lastPersistSuccessAt,
    },
  }
}

export function withDb<T>(fn: (db: DbShape) => T, options?: WithDbOptions): T {
  assertInitialized()
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }

  const shouldPersist = options?.persist !== false
  const result = fn(draftDbCache)
  draftUpdatedAt = new Date().toISOString()
  const hadPublished = Boolean(publishedDbCache)

  if (!publishedDbCache) {
    setPublished(toPublishSnapshot(draftDbCache))
    pendingPublishedChanges = false
  } else {
    pendingPublishedChanges = true
  }

  if (shouldPersist) {
    queuePersist({ persistDraft: true, persistPublished: !hadPublished })
  }
  return result
}

export function withDbRead<T>(fn: (db: DbShape) => T): T {
  assertInitialized()
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  return fn(deepClone(draftDbCache))
}

// Selective read: clones only the selected subset, not the entire draft DB.
export function withDbSelect<T>(selector: (db: DbShape) => T): T {
  assertInitialized()
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  return deepClone(selector(draftDbCache))
}

export function withPublishedDb<T>(fn: (db: DbShape) => T): T {
  ensurePublishedDb()
  if (!publishedDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  const snapshot = deepClone(publishedDbCache)
  return fn(snapshot)
}
