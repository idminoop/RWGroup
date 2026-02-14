import path from 'path'

function resolveDir(rawValue: string | undefined, fallback: string): string {
  const value = rawValue?.trim()
  if (!value) return fallback
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value)
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'server', 'data')
const RESOLVED_DATA_DIR = resolveDir(process.env.RW_DATA_DIR, DEFAULT_DATA_DIR)

const defaultUploadsDir = process.env.RW_DATA_DIR
  ? path.join(RESOLVED_DATA_DIR, 'uploads')
  : path.join(process.cwd(), 'server', 'uploads')

const RESOLVED_UPLOADS_DIR = resolveDir(process.env.RW_UPLOADS_DIR, defaultUploadsDir)

export const DATA_DIR = RESOLVED_DATA_DIR
export const UPLOADS_DIR = RESOLVED_UPLOADS_DIR

