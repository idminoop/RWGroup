import fs from 'fs'
import path from 'path'
import type { DbShape } from '../../shared/types.js'

const DATA_DIR = path.join(process.cwd(), 'server', 'data')
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

function readDbFromFile(filePath: string): DbShape {
  ensureDataDir()
  if (!fs.existsSync(filePath)) {
    throw new Error('DB_NOT_INITIALIZED')
  }
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

export function getDbFilePath(): string {
  return DB_FILE
}

export function getPublishedDbFilePath(): string {
  return PUBLISHED_DB_FILE
}

export function dbExists(): boolean {
  ensureDataDir()
  return fs.existsSync(DB_FILE)
}

export function publishedDbExists(): boolean {
  ensureDataDir()
  return fs.existsSync(PUBLISHED_DB_FILE)
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readDb(): DbShape {
  return readDbFromFile(DB_FILE)
}

export function writeDb(db: DbShape): void {
  writeDbToFile(DB_FILE, db)
}

export function ensurePublishedDb(): void {
  ensureDataDir()
  if (fs.existsSync(PUBLISHED_DB_FILE)) return
  if (!fs.existsSync(DB_FILE)) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  const draft = readDb()
  writeDbToFile(PUBLISHED_DB_FILE, toPublishSnapshot(draft))
}

export function readPublishedDb(): DbShape {
  ensurePublishedDb()
  return readDbFromFile(PUBLISHED_DB_FILE)
}

export function writePublishedDb(db: DbShape): void {
  writeDbToFile(PUBLISHED_DB_FILE, toPublishSnapshot(db))
}

export function publishDraft(): { published_at?: string } {
  const draft = readDb()
  writePublishedDb(draft)
  return { published_at: getFileMtimeIso(PUBLISHED_DB_FILE) }
}

export function hasPendingPublishedChanges(): boolean {
  const draft = toPublishSnapshot(readDb())
  const published = toPublishSnapshot(readPublishedDb())
  return JSON.stringify(draft) !== JSON.stringify(published)
}

export function getPublishStatus(): {
  has_pending_changes: boolean
  draft_updated_at?: string
  published_at?: string
} {
  return {
    has_pending_changes: hasPendingPublishedChanges(),
    draft_updated_at: getFileMtimeIso(DB_FILE),
    published_at: getFileMtimeIso(PUBLISHED_DB_FILE),
  }
}

export function withDb<T>(fn: (db: DbShape) => T): T {
  const db = readDb()
  const result = fn(db)
  writeDb(db)
  return result
}

export function withPublishedDb<T>(fn: (db: DbShape) => T): T {
  const db = readPublishedDb()
  return fn(db)
}
