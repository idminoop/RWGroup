import fs from 'fs/promises'
import path from 'path'
import { DATA_DIR } from './paths.js'
import { newId } from './ids.js'
import { readDb, withDb } from './storage.js'
import { addAuditLog } from './audit.js'
import type {
  Collection,
  Complex,
  DbShape,
  FeedSource,
  LeadStatus,
  HomeContent,
  LandingFeaturePreset,
  Property,
} from '../../shared/types.js'

export type BackupKind = 'auto' | 'manual'

export type BackupContentSnapshot = {
  home: HomeContent
  feed_sources: FeedSource[]
  complexes: Complex[]
  properties: Property[]
  collections: Collection[]
  landing_feature_presets: LandingFeaturePreset[]
  hidden_landing_feature_preset_keys: string[]
}

export type LeadProcessingSnapshotItem = {
  id: string
  lead_status: LeadStatus
  assignee: string
  admin_note: string
}

type BackupFilePayload = {
  version: 1
  id: string
  kind: BackupKind
  label?: string
  created_at: string
  created_by_admin_id?: string
  created_by_login?: string
  content: BackupContentSnapshot
  lead_processing?: LeadProcessingSnapshotItem[]
}

export type BackupMeta = {
  id: string
  kind: BackupKind
  label?: string
  created_at: string
  created_by_admin_id?: string
  created_by_login?: string
  size_bytes: number
}

export type LeadProcessingBackupMeta = BackupMeta & {
  snapshot_leads_count: number
}

export type LeadProcessingRestoreResult = {
  backup_id: string
  total_snapshot: number
  applied: number
  unchanged: number
  missing: number
}

const BACKUPS_DIR = path.join(DATA_DIR, 'backups')
const BACKUP_FILE_EXT = '.json'
const BACKUP_VERSION = 1
export const AUTO_BACKUP_KEEP_COUNT = 3
export const AUTO_BACKUP_CHECK_INTERVAL_MS = 10 * 60 * 1000

let inFlight = false
let intervalId: ReturnType<typeof setInterval> | null = null
let startupTimeoutId: ReturnType<typeof setTimeout> | null = null

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

function backupFilePath(id: string): string {
  return path.join(BACKUPS_DIR, `${id}${BACKUP_FILE_EXT}`)
}

function sanitizeBackupId(id: string): string | null {
  if (!id || typeof id !== 'string') return null
  const value = id.trim()
  if (!value) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null
  return value
}

function normalizeLabel(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const label = input.trim()
  if (!label) return undefined
  return label.slice(0, 120)
}

function normalizeLeadStatus(value: unknown): LeadStatus {
  if (value === 'new' || value === 'in_progress' || value === 'done' || value === 'spam') {
    return value
  }
  return 'new'
}

function extractContentSnapshot(db: DbShape): BackupContentSnapshot {
  return {
    home: db.home,
    feed_sources: db.feed_sources,
    complexes: db.complexes,
    properties: db.properties,
    collections: db.collections,
    landing_feature_presets: db.landing_feature_presets,
    hidden_landing_feature_preset_keys: db.hidden_landing_feature_preset_keys,
  }
}

function extractLeadProcessingSnapshot(db: DbShape): LeadProcessingSnapshotItem[] {
  if (!Array.isArray(db.leads)) return []
  return db.leads.map((lead) => ({
    id: lead.id,
    lead_status: lead.lead_status || 'new',
    assignee: lead.assignee || '',
    admin_note: lead.admin_note || '',
  }))
}

function applyContentSnapshot(target: DbShape, snapshot: BackupContentSnapshot): void {
  target.home = deepClone(snapshot.home)
  target.feed_sources = deepClone(snapshot.feed_sources)
  target.complexes = deepClone(snapshot.complexes)
  target.properties = deepClone(snapshot.properties)
  target.collections = deepClone(snapshot.collections)
  target.landing_feature_presets = deepClone(snapshot.landing_feature_presets)
  target.hidden_landing_feature_preset_keys = deepClone(snapshot.hidden_landing_feature_preset_keys)
}

async function ensureBackupsDir(): Promise<void> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true })
}

function toMeta(payload: BackupFilePayload, sizeBytes: number): BackupMeta {
  return {
    id: payload.id,
    kind: payload.kind,
    label: payload.label,
    created_at: payload.created_at,
    created_by_admin_id: payload.created_by_admin_id,
    created_by_login: payload.created_by_login,
    size_bytes: sizeBytes,
  }
}

function parseBackupPayload(raw: string): BackupFilePayload | null {
  try {
    const value = JSON.parse(raw) as Partial<BackupFilePayload>
    if (!value || value.version !== BACKUP_VERSION) return null
    if (typeof value.id !== 'string' || !value.id) return null
    if (value.kind !== 'auto' && value.kind !== 'manual') return null
    if (typeof value.created_at !== 'string' || !value.created_at) return null
    if (!value.content || typeof value.content !== 'object') return null
    if (value.lead_processing !== undefined && !Array.isArray(value.lead_processing)) return null
    return value as BackupFilePayload
  } catch {
    return null
  }
}

async function readBackupFileById(id: string): Promise<BackupFilePayload | null> {
  const safeId = sanitizeBackupId(id)
  if (!safeId) return null
  try {
    const raw = await fs.readFile(backupFilePath(safeId), 'utf-8')
    return parseBackupPayload(raw)
  } catch {
    return null
  }
}

async function listBackupFilesRaw(): Promise<Array<{ payload: BackupFilePayload; filePath: string; sizeBytes: number }>> {
  await ensureBackupsDir()
  const files = await fs.readdir(BACKUPS_DIR, { withFileTypes: true })
  const result: Array<{ payload: BackupFilePayload; filePath: string; sizeBytes: number }> = []

  for (const entry of files) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(BACKUP_FILE_EXT)) continue
    const filePath = path.join(BACKUPS_DIR, entry.name)
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const payload = parseBackupPayload(raw)
      if (!payload) continue
      const stat = await fs.stat(filePath)
      result.push({ payload, filePath, sizeBytes: stat.size })
    } catch {
      continue
    }
  }

  return result
}

async function createBackupInternal(
  kind: BackupKind,
  options?: { label?: string; adminId?: string; adminLogin?: string },
): Promise<BackupMeta> {
  await ensureBackupsDir()
  const db = readDb()

  const now = new Date().toISOString()
  const payload: BackupFilePayload = {
    version: 1,
    id: newId(),
    kind,
    label: normalizeLabel(options?.label),
    created_at: now,
    created_by_admin_id: options?.adminId,
    created_by_login: options?.adminLogin,
    content: extractContentSnapshot(db),
    lead_processing: extractLeadProcessingSnapshot(db),
  }

  const content = JSON.stringify(payload, null, 2)
  const filePath = backupFilePath(payload.id)
  await fs.writeFile(filePath, content, 'utf-8')
  const stat = await fs.stat(filePath)
  return toMeta(payload, stat.size)
}

async function enforceAutoRetention(): Promise<string[]> {
  const all = await listBackupFilesRaw()
  const autos = all
    .filter((item) => item.payload.kind === 'auto')
    .sort((a, b) => b.payload.created_at.localeCompare(a.payload.created_at))

  if (autos.length <= AUTO_BACKUP_KEEP_COUNT) return []

  const stale = autos.slice(AUTO_BACKUP_KEEP_COUNT)
  const removedIds: string[] = []
  for (const item of stale) {
    try {
      await fs.unlink(item.filePath)
      removedIds.push(item.payload.id)
    } catch {
      continue
    }
  }
  return removedIds
}

export async function listBackups(): Promise<BackupMeta[]> {
  const all = await listBackupFilesRaw()
  return all
    .map((item) => toMeta(item.payload, item.sizeBytes))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function listLeadProcessingBackups(): Promise<LeadProcessingBackupMeta[]> {
  const all = await listBackupFilesRaw()
  return all
    .map((item) => ({
      ...toMeta(item.payload, item.sizeBytes),
      snapshot_leads_count: Array.isArray(item.payload.lead_processing) ? item.payload.lead_processing.length : 0,
    }))
    .filter((item) => item.snapshot_leads_count > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function createManualBackup(options?: {
  label?: string
  adminId?: string
  adminLogin?: string
}): Promise<BackupMeta> {
  const created = await createBackupInternal('manual', options)
  return created
}

export async function deleteBackupById(id: string): Promise<boolean> {
  const safeId = sanitizeBackupId(id)
  if (!safeId) return false
  try {
    await fs.unlink(backupFilePath(safeId))
    return true
  } catch {
    return false
  }
}

export async function restoreBackupById(id: string): Promise<BackupMeta | null> {
  const payload = await readBackupFileById(id)
  if (!payload) return null

  withDb((db) => {
    applyContentSnapshot(db, payload.content)

    // Roll back "feed deleted" import markers that happened after backup creation.
    if (Array.isArray(db.import_runs)) {
      const restoredSourceIds = new Set(payload.content.feed_sources.map((feed) => feed.id))
      db.import_runs = db.import_runs.filter((run) => {
        if (run.action !== 'delete') return true
        if (!restoredSourceIds.has(run.source_id)) return true
        return (run.started_at || '') < payload.created_at
      })
    }
  })

  const filePath = backupFilePath(payload.id)
  const stat = await fs.stat(filePath)
  return toMeta(payload, stat.size)
}

export async function restoreLeadProcessingByBackupId(id: string): Promise<LeadProcessingRestoreResult | null> {
  const payload = await readBackupFileById(id)
  if (!payload) return null

  const snapshot = Array.isArray(payload.lead_processing) ? payload.lead_processing : []
  let applied = 0
  let unchanged = 0
  let missing = 0
  const now = new Date().toISOString()

  withDb((db) => {
    const byId = new Map(db.leads.map((lead) => [lead.id, lead]))
    for (const item of snapshot) {
      if (!item || typeof item.id !== 'string' || !item.id) {
        missing += 1
        continue
      }

      const lead = byId.get(item.id)
      if (!lead) {
        missing += 1
        continue
      }

      const nextStatus = normalizeLeadStatus(item.lead_status)
      const nextAssignee = typeof item.assignee === 'string' ? item.assignee : ''
      const nextAdminNote = typeof item.admin_note === 'string' ? item.admin_note : ''

      const currentStatus = lead.lead_status || 'new'
      const currentAssignee = lead.assignee || ''
      const currentAdminNote = lead.admin_note || ''

      const changed =
        currentStatus !== nextStatus ||
        currentAssignee !== nextAssignee ||
        currentAdminNote !== nextAdminNote

      if (changed) {
        lead.lead_status = nextStatus
        lead.assignee = nextAssignee
        lead.admin_note = nextAdminNote
        lead.updated_at = now
        applied += 1
      } else {
        unchanged += 1
      }
    }
  })

  return {
    backup_id: payload.id,
    total_snapshot: snapshot.length,
    applied,
    unchanged,
    missing,
  }
}

export async function runDailyAutoBackupCheck(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const backups = await listBackups()
    const today = dayKey(new Date().toISOString())
    const hasAutoForToday = backups.some((backup) => backup.kind === 'auto' && dayKey(backup.created_at) === today)
    if (!hasAutoForToday) {
      const created = await createBackupInternal('auto', {
        label: `Daily ${today}`,
      })
      addAuditLog(
        'system',
        'system',
        'create',
        'settings',
        created.id,
        `Создан автобекап: ${created.id}`,
        created.label ? `label=${created.label}` : undefined,
      )
      console.log(`[backup-scheduler] Created auto backup for ${today}`)
    }
    const removedAutoIds = await enforceAutoRetention()
    for (const removedId of removedAutoIds) {
      addAuditLog(
        'system',
        'system',
        'delete',
        'settings',
        removedId,
        `Удален автобекап по лимиту хранения: ${removedId}`,
      )
    }
  } catch (error) {
    console.error('[backup-scheduler] Failed:', error)
  } finally {
    inFlight = false
  }
}

export function startBackupScheduler(): void {
  if (intervalId) return
  console.log('[backup-scheduler] Started (checking every 10 minutes)')
  intervalId = setInterval(() => {
    void runDailyAutoBackupCheck()
  }, AUTO_BACKUP_CHECK_INTERVAL_MS)
  startupTimeoutId = setTimeout(() => {
    startupTimeoutId = null
    void runDailyAutoBackupCheck()
  }, 10_000)
}

export function stopBackupScheduler(): void {
  if (startupTimeoutId) {
    clearTimeout(startupTimeoutId)
    startupTimeoutId = null
  }
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('[backup-scheduler] Stopped')
  }
}
