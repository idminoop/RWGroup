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

type PublishSnapshot = Omit<DbShape, 'admin_users' | 'leads' | 'import_runs' | 'audit_logs'> & {
  admin_users: []
  leads: []
  import_runs: []
  audit_logs: []
}

function toPublishSnapshot(db: DbShape): PublishSnapshot {
  return {
    ...db,
    admin_users: [],
    leads: [],
    import_runs: [],
    audit_logs: [],
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowIso(): string {
  return new Date().toISOString()
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

let persistQueue: Promise<void> = Promise.resolve()

type PersistRequest = {
  persistDraft: boolean
  persistPublished: boolean
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

function queuePersist(request: PersistRequest): void {
  if (!repository || !draftDbCache || !publishedDbCache) return
  if (!request.persistDraft && !request.persistPublished) return

  const draftSnapshot = deepClone(draftDbCache)
  const publishedSnapshot = deepClone(publishedDbCache)

  persistQueue = persistQueue
    .then(async () => {
      if (!repository) return
      const meta = await repository.saveState(draftSnapshot, publishedSnapshot, request)
      if (meta.draftUpdatedAt) draftUpdatedAt = meta.draftUpdatedAt
      if (meta.publishedAt) publishedAt = meta.publishedAt
    })
    .catch((error) => {
      console.error('[storage] Persist error:', error)
    })
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

  initialized = true
}

export async function flushStorage(): Promise<void> {
  await persistQueue
}

export async function closeStorage(): Promise<void> {
  if (!initialized) return
  await flushStorage()
  if (repository) {
    await repository.close()
  }
  repository = null
  activeStorageDriver = 'unknown'
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
  queuePersist({ persistDraft: !hadDraft, persistPublished: true })
}

export function publishDraft(): { published_at?: string } {
  assertInitialized()
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  setPublished(toPublishSnapshot(draftDbCache))
  queuePersist({ persistDraft: false, persistPublished: true })
  return { published_at: publishedAt }
}

export function hasPendingPublishedChanges(): boolean {
  if (!draftDbCache) return false
  const draft = toPublishSnapshot(draftDbCache)
  const published = publishedDbCache ? toPublishSnapshot(publishedDbCache) : null
  if (!published) return true
  return JSON.stringify(draft) !== JSON.stringify(published)
}

export function getPublishStatus(): {
  has_pending_changes: boolean
  draft_updated_at?: string
  published_at?: string
} {
  return {
    has_pending_changes: hasPendingPublishedChanges(),
    draft_updated_at: draftUpdatedAt,
    published_at: publishedAt,
  }
}

export function withDb<T>(fn: (db: DbShape) => T): T {
  assertInitialized()
  if (!draftDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }

  const result = fn(draftDbCache)
  draftUpdatedAt = new Date().toISOString()
  const hadPublished = Boolean(publishedDbCache)

  if (!publishedDbCache) {
    setPublished(toPublishSnapshot(draftDbCache))
  }

  queuePersist({ persistDraft: true, persistPublished: !hadPublished })
  return result
}

export function withPublishedDb<T>(fn: (db: DbShape) => T): T {
  ensurePublishedDb()
  if (!publishedDbCache) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  const snapshot = deepClone(publishedDbCache)
  return fn(snapshot)
}
