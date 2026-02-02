import fs from 'fs'
import path from 'path'
import type { DbShape } from '../../shared/types.js'

const DATA_DIR = path.join(process.cwd(), 'server', 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')

export function getDbFilePath(): string {
  return DB_FILE
}

export function dbExists(): boolean {
  ensureDataDir()
  return fs.existsSync(DB_FILE)
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readDb(): DbShape {
  ensureDataDir()
  if (!fs.existsSync(DB_FILE)) {
    throw new Error('DB_NOT_INITIALIZED')
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8')
  return JSON.parse(raw) as DbShape
}

export function writeDb(db: DbShape): void {
  ensureDataDir()
  const tmp = `${DB_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8')
  fs.renameSync(tmp, DB_FILE)
}

export function withDb<T>(fn: (db: DbShape) => T): T {
  const db = readDb()
  const result = fn(db)
  writeDb(db)
  return result
}
