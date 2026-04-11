import { withDb, withDbRead } from './storage.js'
import { newId } from './ids.js'
import {
  upsertProperties,
  upsertComplexesFromProperties,
  normalizeYandexRealty,
} from './import-logic.js'
import { assertFeedRowLimit, fetchFeedBuffer } from './feed-fetch.js'
import { XMLParser } from 'fast-xml-parser'
import { parse as parseCsv } from 'csv-parse/sync'
import * as XLSX from 'xlsx'
import type { FeedSource } from '../../shared/types.js'

const CHECK_INTERVAL_MS = 60_000 // Check every minute
const inFlightFeedIds = new Set<string>()

function isTrendAgentAboutUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase()
    return pathname.endsWith('/about.json') || pathname.endsWith('about.json')
  } catch {
    return value.toLowerCase().includes('about.json')
  }
}

function guessExt(name: string): 'csv' | 'xlsx' | 'xml' | 'json' {
  let lc = name.toLowerCase()
  try {
    lc = new URL(name).pathname.toLowerCase()
  } catch {
    // Keep original string for local names.
  }
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
    const rows = parseCsv(raw, { columns: true, skip_empty_lines: true }) as Record<string, unknown>[]
    assertFeedRowLimit(rows.length)
    return rows
  }
  if (ext === 'xlsx') {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]
    assertFeedRowLimit(rows.length)
    return rows
  }
  if (ext === 'xml') {
    const parser = new XMLParser({ ignoreAttributes: false })
    const obj = parser.parse(buffer.toString('utf-8'))
    const arr = findFirstArray(obj)
    const rows = (arr || []) as Record<string, unknown>[]
    assertFeedRowLimit(rows.length)
    return rows.map((row) => normalizeYandexRealty(row))
  }
  const obj = JSON.parse(buffer.toString('utf-8'))
  if (Array.isArray(obj)) {
    assertFeedRowLimit(obj.length)
    return obj as Record<string, unknown>[]
  }
  const arr = findFirstArray(obj)
  const rows = (arr || []) as Record<string, unknown>[]
  assertFeedRowLimit(rows.length)
  return rows
}

async function refreshFeed(feed: FeedSource): Promise<void> {
  if (!feed.url) return
  if (inFlightFeedIds.has(feed.id)) {
    console.log(`[feed-scheduler] Skip "${feed.name}": previous run still in progress`)
    return
  }
  inFlightFeedIds.add(feed.id)

  console.log(`[feed-scheduler] Auto-refreshing feed "${feed.name}" from ${feed.url}`)

  const runId = newId()
  const startedAt = new Date().toISOString()
  let finishedAt = startedAt
  let status: 'success' | 'failed' | 'partial' = 'success'
  let stats = { inserted: 0, updated: 0, hidden: 0 }
  let errorLog = ''
  let rows: Record<string, unknown>[] = []
  let shouldApply = false
  let skippedTrendAgentManifest = false

  try {
    if (isTrendAgentAboutUrl(feed.url)) {
      skippedTrendAgentManifest = true
      status = 'failed'
      errorLog = 'TrendAgent about.json is a manifest file. Auto-refresh is disabled; use manual TrendAgent import.'
    } else {
      const buffer = await fetchFeedBuffer(feed.url)
      const ext = guessExt(feed.url)
      rows = parseRows(buffer, ext)
      shouldApply = true
    }
  } catch (e) {
    status = 'failed'
    errorLog = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[feed-scheduler] Feed "${feed.name}" failed:`, errorLog)
  } finally {
    try {
      finishedAt = new Date().toISOString()
      withDb((db) => {
        if (shouldApply) {
          const mapping = feed.mapping
          upsertComplexesFromProperties(db, feed.id, rows, mapping)
          const result = upsertProperties(db, feed.id, rows, mapping)
          stats = { inserted: result.inserted, updated: result.updated, hidden: result.hidden }

          if (result.errors.length > 0) {
            status = result.errors.length === rows.length ? 'failed' : 'partial'
            errorLog = `${result.errors.length} строк с ошибками:\n` +
              result.errors.slice(0, 50).map((entry) =>
                `Строка ${entry.rowIndex}${entry.externalId ? ` (${entry.externalId})` : ''}: ${entry.error}`,
              ).join('\n')
          }

        }

        const currentFeed = db.feed_sources.find((source) => source.id === feed.id)
        if (currentFeed && (shouldApply || skippedTrendAgentManifest)) {
          currentFeed.last_auto_refresh = finishedAt
        }

        db.import_runs.unshift({
          id: runId,
          source_id: feed.id,
          entity: 'property',
          started_at: startedAt,
          finished_at: finishedAt,
          status,
          stats,
          error_log: errorLog || undefined,
          feed_name: feed.name,
          feed_url: feed.url,
          action: 'import',
        })
      })

      if (shouldApply && status !== 'failed') {
        console.log(`[feed-scheduler] Feed "${feed.name}": +${stats.inserted} / upd ${stats.updated} / hidden ${stats.hidden}`)
      }
    } finally {
      inFlightFeedIds.delete(feed.id)
    }
  }
}

function checkFeeds(): void {
  const now = Date.now()

  const feeds = withDbRead((db) => db.feed_sources.filter(
    (f) => f.is_active && f.mode === 'url' && f.url && f.auto_refresh,
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
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null

export function startFeedScheduler(): void {
  if (intervalId) return
  console.log('[feed-scheduler] Started (checking every 60s)')
  intervalId = setInterval(checkFeeds, CHECK_INTERVAL_MS)
  // Run first check after 10s delay to let server fully start
  startupTimeoutId = setTimeout(() => {
    startupTimeoutId = null
    checkFeeds()
  }, 10_000)
}

export function stopFeedScheduler(): void {
  if (startupTimeoutId) {
    clearTimeout(startupTimeoutId)
    startupTimeoutId = null
  }
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('[feed-scheduler] Stopped')
  }
}
