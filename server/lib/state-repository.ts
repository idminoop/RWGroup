import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import type { DbShape } from '../../shared/types.js'
import { DATA_DIR } from './paths.js'
import {
  AdminRepository,
  CatalogRepository,
  composeDbShape,
  FeedRepository,
  HomeRepository,
  LandingRepository,
  type Scope,
} from './pg/domain-repositories.js'

export type StorageDriver = 'file' | 'postgres'

export type StoredState = {
  draft: DbShape | null
  published: DbShape | null
  draftUpdatedAt?: string
  publishedAt?: string
}

export type PersistedMeta = {
  draftUpdatedAt?: string
  publishedAt?: string
}

export type SaveStateOptions = {
  persistDraft?: boolean
  persistPublished?: boolean
}

export interface StateRepository {
  readonly driver: StorageDriver
  initialize(): Promise<void>
  loadState(): Promise<StoredState>
  saveState(draft: DbShape, published: DbShape, options?: SaveStateOptions): Promise<PersistedMeta>
  close(): Promise<void>
}

const DB_FILE = path.join(DATA_DIR, 'db.json')
const PUBLISHED_DB_FILE = path.join(DATA_DIR, 'db.published.json')
const MIGRATIONS_TABLE = 'rw_schema_migrations'
const LEGACY_STATE_TABLE = 'rw_app_state'
const STORAGE_META_TABLE = 'rw_storage_meta'

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readDbFromFile(filePath: string): DbShape | null {
  ensureDataDir()
  if (!fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, 'utf-8')
  const db = JSON.parse(raw) as DbShape
  if (!Array.isArray(db.audit_logs)) db.audit_logs = []
  return db
}

function writeDbToFile(filePath: string, db: DbShape): void {
  ensureDataDir()
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8')
  fs.renameSync(tmp, filePath)
}

function getFileMtimeIso(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined
  return fs.statSync(filePath).mtime.toISOString()
}

function sortMigrations(files: string[]): string[] {
  return [...files].sort((a, b) => a.localeCompare(b))
}

function normalizeTimestamp(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : value
}

export class FileStateRepository implements StateRepository {
  readonly driver: StorageDriver = 'file'

  async initialize(): Promise<void> {
    ensureDataDir()
  }

  async loadState(): Promise<StoredState> {
    const draft = readDbFromFile(DB_FILE)
    const published = readDbFromFile(PUBLISHED_DB_FILE)
    return {
      draft,
      published,
      draftUpdatedAt: getFileMtimeIso(DB_FILE),
      publishedAt: getFileMtimeIso(PUBLISHED_DB_FILE),
    }
  }

  async saveState(draft: DbShape, published: DbShape, options?: SaveStateOptions): Promise<PersistedMeta> {
    const persistDraft = options?.persistDraft ?? true
    const persistPublished = options?.persistPublished ?? true
    if (persistDraft) {
      writeDbToFile(DB_FILE, draft)
    }
    if (persistPublished) {
      writeDbToFile(PUBLISHED_DB_FILE, published)
    }
    return {
      draftUpdatedAt: getFileMtimeIso(DB_FILE),
      publishedAt: getFileMtimeIso(PUBLISHED_DB_FILE),
    }
  }

  async close(): Promise<void> {
    // Nothing to close for file backend.
  }
}

type PostgresConfig = {
  connectionString: string
  migrationsDir: string
}

async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  )

  if (!fs.existsSync(migrationsDir)) return

  const files = sortMigrations(
    fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))
  )
  if (files.length === 0) return

  const appliedResult = await pool.query<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`)
  const applied = new Set(appliedResult.rows.map((row) => row.name))

  for (const file of files) {
    if (applied.has(file)) continue

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [file])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

export class PostgresStateRepository implements StateRepository {
  readonly driver: StorageDriver = 'postgres'
  private readonly pool: Pool
  private readonly migrationsDir: string
  private readonly homeRepository: HomeRepository
  private readonly feedRepository: FeedRepository
  private readonly catalogRepository: CatalogRepository
  private readonly adminRepository: AdminRepository
  private readonly landingRepository: LandingRepository

  constructor(config: PostgresConfig) {
    this.pool = new Pool({ connectionString: config.connectionString })
    this.migrationsDir = config.migrationsDir
    this.homeRepository = new HomeRepository()
    this.feedRepository = new FeedRepository()
    this.catalogRepository = new CatalogRepository()
    this.adminRepository = new AdminRepository()
    this.landingRepository = new LandingRepository()
  }

  private async replaceScope(client: import('pg').PoolClient, scope: Scope, db: DbShape): Promise<void> {
    await this.homeRepository.replace(client, scope, db.home)
    await this.feedRepository.replace(client, scope, {
      feed_sources: db.feed_sources,
      import_runs: db.import_runs,
    })
    await this.catalogRepository.replace(client, scope, {
      complexes: db.complexes,
      properties: db.properties,
      collections: db.collections,
    })
    await this.adminRepository.replace(client, scope, {
      admin_users: db.admin_users,
      leads: db.leads,
      audit_logs: db.audit_logs,
    })
    await this.landingRepository.replace(client, scope, {
      landing_feature_presets: db.landing_feature_presets,
      hidden_landing_feature_preset_keys: db.hidden_landing_feature_preset_keys,
    })
  }

  private async loadScope(client: import('pg').PoolClient, scope: Scope): Promise<DbShape | null> {
    const home = await this.homeRepository.load(client, scope)
    if (!home) return null

    const feed = await this.feedRepository.load(client, scope)
    const catalog = await this.catalogRepository.load(client, scope)
    const admin = await this.adminRepository.load(client, scope)
    const landing = await this.landingRepository.load(client, scope)

    return composeDbShape(home, feed, catalog, admin, landing)
  }

  private async bootstrapFromLegacyState(): Promise<void> {
    const probe = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rw_home_content WHERE scope = 'draft'`
    )
    const hasNormalizedDraft = Number(probe.rows[0]?.count || '0') > 0
    if (hasNormalizedDraft) return

    const legacy = await this.pool.query<{
      draft_json: DbShape
      published_json: DbShape
      draft_updated_at: Date | string | null
      published_updated_at: Date | string | null
    }>(
      `SELECT draft_json, published_json, draft_updated_at, published_updated_at
       FROM ${LEGACY_STATE_TABLE}
       WHERE id = 1`
    )

    if (legacy.rows.length === 0) return

    const row = legacy.rows[0]
    const draft = row.draft_json
    const published = row.published_json || row.draft_json
    if (!draft) return

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await this.replaceScope(client, 'draft', draft)
      await this.replaceScope(client, 'published', published)
      await client.query(
        `INSERT INTO ${STORAGE_META_TABLE} (id, draft_updated_at, published_updated_at, updated_at)
         VALUES (1, COALESCE($1, NOW()), COALESCE($2, NOW()), NOW())
         ON CONFLICT (id)
         DO UPDATE SET
           draft_updated_at = COALESCE(EXCLUDED.draft_updated_at, ${STORAGE_META_TABLE}.draft_updated_at),
           published_updated_at = COALESCE(EXCLUDED.published_updated_at, ${STORAGE_META_TABLE}.published_updated_at),
           updated_at = NOW()`,
        [row.draft_updated_at || null, row.published_updated_at || null]
      )
      await client.query('COMMIT')
      console.log('[storage] Bootstrapped normalized PostgreSQL tables from legacy state row')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async initialize(): Promise<void> {
    await runMigrations(this.pool, this.migrationsDir)
    await this.bootstrapFromLegacyState()
  }

  async loadState(): Promise<StoredState> {
    const client = await this.pool.connect()
    try {
      const draft = await this.loadScope(client, 'draft')
      const published = await this.loadScope(client, 'published')

      const metaResult = await client.query<{
        draft_updated_at: Date | string | null
        published_updated_at: Date | string | null
      }>(
        `SELECT draft_updated_at, published_updated_at
         FROM ${STORAGE_META_TABLE}
         WHERE id = 1`
      )

      const metaRow = metaResult.rows[0]
      return {
        draft,
        published,
        draftUpdatedAt:
          metaRow?.draft_updated_at instanceof Date
            ? metaRow.draft_updated_at.toISOString()
            : (metaRow?.draft_updated_at as string | undefined),
        publishedAt:
          metaRow?.published_updated_at instanceof Date
            ? metaRow.published_updated_at.toISOString()
            : (metaRow?.published_updated_at as string | undefined),
      }
    } finally {
      client.release()
    }
  }

  async saveState(draft: DbShape, published: DbShape, options?: SaveStateOptions): Promise<PersistedMeta> {
    const persistDraft = options?.persistDraft ?? true
    const persistPublished = options?.persistPublished ?? true
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (persistDraft) {
        await this.replaceScope(client, 'draft', draft)
      }
      if (persistPublished) {
        await this.replaceScope(client, 'published', published)
      }
      const metaResult = await client.query<{
        draft_updated_at: Date
        published_updated_at: Date
      }>(
        `INSERT INTO ${STORAGE_META_TABLE} (id, draft_updated_at, published_updated_at, updated_at)
         VALUES (
           1,
           CASE WHEN $1 THEN NOW() ELSE NULL END,
           CASE WHEN $2 THEN NOW() ELSE NULL END,
           NOW()
         )
         ON CONFLICT (id)
         DO UPDATE SET
           draft_updated_at = CASE WHEN $1 THEN NOW() ELSE ${STORAGE_META_TABLE}.draft_updated_at END,
           published_updated_at = CASE WHEN $2 THEN NOW() ELSE ${STORAGE_META_TABLE}.published_updated_at END,
           updated_at = NOW()
         RETURNING draft_updated_at, published_updated_at`
        ,
        [persistDraft, persistPublished]
      )
      await client.query('COMMIT')
      const row = metaResult.rows[0]
      return {
        draftUpdatedAt: normalizeTimestamp(row?.draft_updated_at),
        publishedAt: normalizeTimestamp(row?.published_updated_at),
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export function createStateRepository(): StateRepository {
  const rawDriver = (process.env.RW_STORAGE_DRIVER || 'auto').trim().toLowerCase()
  const hasDbUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim())

  const driver: 'auto' | StorageDriver =
    rawDriver === 'file' || rawDriver === 'postgres' ? rawDriver : 'auto'

  if (driver === 'postgres' || (driver === 'auto' && hasDbUrl)) {
    if (!process.env.DATABASE_URL) {
      throw new Error('RW_STORAGE_DRIVER=postgres requires DATABASE_URL')
    }
    const migrationsDir =
      process.env.RW_MIGRATIONS_DIR && process.env.RW_MIGRATIONS_DIR.trim()
        ? path.isAbsolute(process.env.RW_MIGRATIONS_DIR)
          ? process.env.RW_MIGRATIONS_DIR
          : path.join(process.cwd(), process.env.RW_MIGRATIONS_DIR)
        : path.join(process.cwd(), 'server', 'migrations')

    return new PostgresStateRepository({
      connectionString: process.env.DATABASE_URL,
      migrationsDir,
    })
  }

  return new FileStateRepository()
}

export function readLocalStateFiles(): StoredState {
  const draft = readDbFromFile(DB_FILE)
  const published = readDbFromFile(PUBLISHED_DB_FILE)
  return {
    draft,
    published,
    draftUpdatedAt: getFileMtimeIso(DB_FILE),
    publishedAt: getFileMtimeIso(PUBLISHED_DB_FILE),
  }
}
