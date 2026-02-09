import { withDb } from './storage.js'
import { newId } from './ids.js'
import {
  upsertComplexes,
  upsertProperties,
  upsertComplexesFromProperties,
  normalizeYandexRealty,
} from './import-logic.js'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import type { FeedSource } from '../../shared/types.js'

const CHECK_INTERVAL_MS = 60_000 // Check every minute

function guessExt(name: string): 'csv' | 'xlsx' | 'xml' | 'json' {
  const lc = name.toLowerCase()
  if (lc.endsWith('.csv')) return 'csv'
  if (lc.endsWith('.xlsx') || lc.endsWith('.xls')) return 'xlsx'
  if (lc.endsWith('.xml')) return 'xml'
  return 'json'
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

function parseRows(buffer: Buffer, ext: 'csv' | 'xlsx' | 'xml' | 'json'): Record<string, unknown>[] {
  if (ext === 'csv') {
    const raw = buffer.toString('utf-8')
    return parseCsv(raw, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]
  }
  if (ext === 'xlsx') {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    const sheet = wb.Sheets[sheetName]
    return XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]
  }
  if (ext === 'xml') {
    const parser = new XMLParser({ ignoreAttributes: false })
    const obj = parser.parse(buffer.toString('utf-8'))
    const arr = findFirstArray(obj)
    return ((arr || []) as Record<string, unknown>[]).map(row => normalizeYandexRealty(row))
  }
  const obj = JSON.parse(buffer.toString('utf-8'))
  if (Array.isArray(obj)) return obj as Record<string, unknown>[]
  const arr = findFirstArray(obj)
  return (arr || []) as Record<string, unknown>[]
}

async function refreshFeed(feed: FeedSource): Promise<void> {
  if (!feed.url) return

  console.log(`[feed-scheduler] Auto-refreshing feed "${feed.name}" from ${feed.url}`)

  const runId = newId()
  const startedAt = new Date().toISOString()
  let status: 'success' | 'failed' | 'partial' = 'success'
  let stats = { inserted: 0, updated: 0, hidden: 0 }
  let errorLog = ''

  try {
    const r = await fetch(feed.url)
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`)
    const ab = await r.arrayBuffer()
    const buffer = Buffer.from(ab)

    const ext = guessExt(feed.url)
    const rows = parseRows(buffer, ext)

    const result = withDb((db) => {
      const mapping = feed.mapping
      // Auto-upsert complexes from properties
      upsertComplexesFromProperties(db, feed.id, rows, mapping)
      return upsertProperties(db, feed.id, rows, mapping)
    })

    stats = { inserted: result.inserted, updated: result.updated, hidden: result.hidden }

    if (result.errors.length > 0) {
      status = result.errors.length === rows.length ? 'failed' : 'partial'
      errorLog = `${result.errors.length} строк с ошибками:\n` +
        result.errors.slice(0, 50).map(e =>
          `Строка ${e.rowIndex}${e.externalId ? ` (${e.externalId})` : ''}: ${e.error}`
        ).join('\n')
    }

    // Update last_auto_refresh timestamp
    withDb((db) => {
      const fs = db.feed_sources.find(s => s.id === feed.id)
      if (fs) fs.last_auto_refresh = new Date().toISOString()
    })

    console.log(`[feed-scheduler] Feed "${feed.name}": +${stats.inserted} / upd ${stats.updated} / hidden ${stats.hidden}`)
  } catch (e) {
    status = 'failed'
    errorLog = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[feed-scheduler] Feed "${feed.name}" failed:`, errorLog)
  } finally {
    withDb((db) => {
      db.import_runs.unshift({
        id: runId,
        source_id: feed.id,
        entity: 'property',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status,
        stats,
        error_log: errorLog || undefined,
      })
    })
  }
}

function checkFeeds(): void {
  const now = Date.now()

  const feeds = withDb((db) => db.feed_sources.filter(
    (f) => f.is_active && f.mode === 'url' && f.url && f.auto_refresh
  ))

  for (const feed of feeds) {
    const intervalMs = (feed.refresh_interval_hours || 24) * 3600_000
    const lastRefresh = feed.last_auto_refresh ? new Date(feed.last_auto_refresh).getTime() : 0

    if (now - lastRefresh >= intervalMs) {
      refreshFeed(feed).catch(() => {})
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null

export function startFeedScheduler(): void {
  if (intervalId) return
  console.log('[feed-scheduler] Started (checking every 60s)')
  intervalId = setInterval(checkFeeds, CHECK_INTERVAL_MS)
  // Run first check after 10s delay to let server fully start
  setTimeout(checkFeeds, 10_000)
}

export function stopFeedScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('[feed-scheduler] Stopped')
  }
}
