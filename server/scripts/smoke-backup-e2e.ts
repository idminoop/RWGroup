import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { DbShape } from '../../shared/types.js'

type ApiSuccess<T> = { success: true; data: T }
type ApiFailure = { success: false; error?: string }

function dayOffsetIso(offsetDays: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  date.setUTCHours(9, 0, 0, 0)
  return date.toISOString()
}

function pickBackupContent(db: DbShape) {
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

async function main(): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rw-backup-smoke-'))
  const requestedDriver = (process.env.SMOKE_STORAGE_DRIVER || process.env.RW_STORAGE_DRIVER || 'file')
    .trim()
    .toLowerCase()

  if (requestedDriver !== 'file' && requestedDriver !== 'postgres') {
    throw new Error(`Unsupported SMOKE_STORAGE_DRIVER: ${requestedDriver}`)
  }
  if (requestedDriver === 'postgres' && !process.env.DATABASE_URL) {
    throw new Error('SMOKE_STORAGE_DRIVER=postgres requires DATABASE_URL')
  }

  process.env.RW_DATA_DIR = tempRoot
  process.env.RW_STORAGE_DRIVER = requestedDriver
  process.env.RW_BACKUP_SCHEDULER_ENABLED = 'false'
  process.env.RW_FEED_SCHEDULER_ENABLED = 'false'
  process.env.ADMIN_DEFAULT_LOGIN = 'admin'
  process.env.ADMIN_DEFAULT_PASSWORD = 'admin'

  const [{ default: app }, storage, backups] = await Promise.all([
    import('../app.js'),
    import('../lib/storage.js'),
    import('../lib/backups.js'),
  ])

  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server')
  const base = `http://127.0.0.1:${address.port}`

  async function api<T>(pathname: string, options?: RequestInit): Promise<ApiSuccess<T>> {
    const res = await fetch(`${base}${pathname}`, options)
    const payload = (await res.json()) as ApiSuccess<T> | ApiFailure
    if (!res.ok || !payload || payload.success !== true) {
      throw new Error(
        `API failed ${pathname}: ${res.status} ${res.statusText}; payload=${JSON.stringify(payload)}`,
      )
    }
    return payload
  }

  try {
    const login = await api<{ token: string }>('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'admin' }),
    })
    const token = login.data.token
    const adminHeaders = {
      'content-type': 'application/json',
      'x-admin-token': token,
    }

    // 1) content fidelity: catalog + complex settings + cards + home + presets must be restored exactly
    storage.withDb((db) => {
      if (!db.collections.length) {
        db.collections.push({
          id: 'smoke-collection',
          slug: 'smoke-collection',
          title: 'Smoke Collection',
          priority: 1,
          status: 'visible',
          mode: 'manual',
          items: [],
          updated_at: new Date().toISOString(),
        })
      }
      if (!db.landing_feature_presets.length) {
        db.landing_feature_presets.push({
          key: 'custom_smoke_feature',
          title: 'Smoke Feature',
          image: '/uploads/smoke-feature.jpg',
        })
      }
      if (!db.hidden_landing_feature_preset_keys.length) {
        db.hidden_landing_feature_preset_keys.push('parking')
      }
    })

    const baselineContent = pickBackupContent(storage.readDb())
    const backupFidelity = await api<{ id: string; kind: 'manual' | 'auto' }>('/api/admin/backups', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'critical-content-fidelity' }),
    })
    assert.equal(backupFidelity.data.kind, 'manual')

    storage.withDb((db) => {
      db.home.hero.title = `MUTATED_HOME_${Date.now()}`

      if (db.feed_sources.length) {
        db.feed_sources[0].name = `mutated_feed_${Date.now()}`
      } else {
        db.feed_sources.push({
          id: 'smoke-temp-feed',
          name: 'mutated-temp-feed',
          mode: 'url',
          url: 'https://example.com/mutated-temp.xml',
          format: 'xml',
          is_active: true,
          created_at: new Date().toISOString(),
        })
      }

      if (!db.complexes.length) {
        throw new Error('Smoke requires at least one complex in seed data')
      }
      db.complexes[0].title = `MUTATED_COMPLEX_${Date.now()}`
      db.complexes[0].status = 'hidden'
      db.complexes[0].district = 'MUTATED_DISTRICT'
      db.complexes[0].landing = {
        ...(db.complexes[0].landing || { tags: [], facts: [], feature_ticker: [], plans: { items: [] } }),
        accent_color: '#ff0000',
        tags: [{ id: 'mut_tag', label: 'mutated' }],
      }

      if (!db.properties.length) {
        throw new Error('Smoke requires at least one property in seed data')
      }
      db.properties[0].title = `MUTATED_PROPERTY_${Date.now()}`
      db.properties[0].price = 77777777
      db.properties[0].status = 'hidden'
      db.properties[0].district = 'MUTATED_PROPERTY_DISTRICT'

      db.collections[0].title = `MUTATED_COLLECTION_${Date.now()}`
      db.collections[0].priority = 999

      db.landing_feature_presets.push({
        key: `custom_mut_${Date.now()}`,
        title: 'Mutated Feature',
        image: '/uploads/mutated-feature.jpg',
      })
      db.hidden_landing_feature_preset_keys = Array.from(
        new Set([...db.hidden_landing_feature_preset_keys, 'mutated_hidden_key']),
      )
    })

    const mutatedContent = pickBackupContent(storage.readDb())
    assert.notDeepEqual(mutatedContent, baselineContent, 'Mutation step failed: content did not change')

    await api('/api/admin/backups/' + backupFidelity.data.id + '/restore', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    })

    const restoredContent = pickBackupContent(storage.readDb())
    assert.deepEqual(
      restoredContent,
      baselineContent,
      'Catalog/home/settings content mismatch after restore',
    )

    // 2) leads are intentionally not restored by general backup restore
    const leadBaseId = 'smoke-lead-base'
    storage.withDb((db) => {
      db.leads = db.leads.filter((item) => item.id !== leadBaseId && item.id !== 'smoke-lead-new-after-backup')
      db.leads.unshift({
        id: leadBaseId,
        form_type: 'consultation',
        name: 'Lead Base',
        phone: '+70000000001',
        source: { page: '/' },
        lead_status: 'new',
        assignee: 'manager-a',
        admin_note: 'initial',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    })

    const backupLeads = await api<{ id: string; kind: 'manual' | 'auto' }>('/api/admin/backups', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'critical-leads-invariant' }),
    })
    assert.equal(backupLeads.data.kind, 'manual')

    storage.withDb((db) => {
      const base = db.leads.find((item) => item.id === leadBaseId)
      if (!base) throw new Error('Lead smoke base not found')
      base.lead_status = 'done'
      base.assignee = 'manager-b'
      base.admin_note = 'mutated after backup'
      base.updated_at = new Date().toISOString()
      db.leads.unshift({
        id: 'smoke-lead-new-after-backup',
        form_type: 'consultation',
        name: 'Lead New',
        phone: '+70000000002',
        source: { page: '/' },
        lead_status: 'new',
        created_at: new Date().toISOString(),
      })
    })

    await api('/api/admin/backups/' + backupLeads.data.id + '/restore', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    })

    const leadsInvariant = storage.withDb((db) => {
      const base = db.leads.find((item) => item.id === leadBaseId)
      const newer = db.leads.find((item) => item.id === 'smoke-lead-new-after-backup')
      return {
        base_status: base?.lead_status,
        base_assignee: base?.assignee,
        base_note: base?.admin_note,
        newer_exists: Boolean(newer),
      }
    })
    assert.equal(leadsInvariant.base_status, 'done', 'Lead status must not be rolled back by content restore')
    assert.equal(leadsInvariant.base_assignee, 'manager-b', 'Lead assignee must not be rolled back by content restore')
    assert.equal(
      leadsInvariant.base_note,
      'mutated after backup',
      'Lead note must not be rolled back by content restore',
    )
    assert.equal(leadsInvariant.newer_exists, true, 'New leads must stay after content restore')

    // 3) dedicated lead-processing restore restores handling fields without deleting new leads
    storage.withDb((db) => {
      const base = db.leads.find((item) => item.id === leadBaseId)
      if (!base) throw new Error('Lead smoke base not found before dedicated restore check')
      base.lead_status = 'in_progress'
      base.assignee = 'manager-c'
      base.admin_note = 'snapshot-state'
      base.updated_at = new Date().toISOString()
      db.leads = db.leads.filter((item) => item.id !== 'smoke-lead-new-after-lead-restore')
    })

    const backupLeadProcessing = await api<{ id: string; kind: 'manual' | 'auto' }>('/api/admin/backups', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'critical-lead-processing-restore' }),
    })
    assert.equal(backupLeadProcessing.data.kind, 'manual')

    storage.withDb((db) => {
      const base = db.leads.find((item) => item.id === leadBaseId)
      if (!base) throw new Error('Lead smoke base not found in mutation before dedicated restore')
      base.lead_status = 'spam'
      base.assignee = 'manager-z'
      base.admin_note = 'mutated-before-dedicated-restore'
      base.updated_at = new Date().toISOString()
      db.leads.unshift({
        id: 'smoke-lead-new-after-lead-restore',
        form_type: 'consultation',
        name: 'Lead Newer',
        phone: '+70000000003',
        source: { page: '/' },
        lead_status: 'new',
        created_at: new Date().toISOString(),
      })
    })

    const processingBackups = await api<Array<{ id: string; snapshot_leads_count: number }>>(
      '/api/admin/leads/processing-backups',
      {
        method: 'GET',
        headers: { 'x-admin-token': token },
      },
    )
    const selectedLeadBackup = processingBackups.data.find((item) => item.id === backupLeadProcessing.data.id)
    assert.ok(selectedLeadBackup, 'Dedicated leads-backup list does not contain freshly created backup')
    assert.ok(
      (selectedLeadBackup?.snapshot_leads_count || 0) > 0,
      'Lead-processing snapshot in backup should not be empty',
    )

    const restoreProcessingResult = await api<{
      backup_id: string
      total_snapshot: number
      applied: number
      unchanged: number
      missing: number
    }>('/api/admin/leads/restore-processing', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ backup_id: backupLeadProcessing.data.id }),
    })
    assert.equal(
      restoreProcessingResult.data.backup_id,
      backupLeadProcessing.data.id,
      'Lead-processing restore returned wrong backup id',
    )
    assert.ok(
      restoreProcessingResult.data.applied >= 1,
      'Lead-processing restore should apply at least one change',
    )

    const leadsAfterDedicatedRestore = storage.withDb((db) => {
      const base = db.leads.find((item) => item.id === leadBaseId)
      const newer = db.leads.find((item) => item.id === 'smoke-lead-new-after-lead-restore')
      return {
        base_status: base?.lead_status,
        base_assignee: base?.assignee,
        base_note: base?.admin_note,
        newer_exists: Boolean(newer),
      }
    })
    assert.equal(
      leadsAfterDedicatedRestore.base_status,
      'in_progress',
      'Dedicated lead-processing restore did not restore lead status',
    )
    assert.equal(
      leadsAfterDedicatedRestore.base_assignee,
      'manager-c',
      'Dedicated lead-processing restore did not restore assignee',
    )
    assert.equal(
      leadsAfterDedicatedRestore.base_note,
      'snapshot-state',
      'Dedicated lead-processing restore did not restore admin note',
    )
    assert.equal(
      leadsAfterDedicatedRestore.newer_exists,
      true,
      'Dedicated lead-processing restore must not delete new leads',
    )

    // 4) restore recovers feed and removes stale "delete" run marker
    const feed = await api<{ id: string }>('/api/admin/feeds', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'critical_backup_feed',
        mode: 'url',
        url: 'https://example.com/critical.xml',
        format: 'xml',
        auto_refresh: true,
        refresh_interval_hours: 24,
      }),
    })
    const backupA = await api<{ id: string; kind: 'manual' | 'auto' }>('/api/admin/backups', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'critical-before-delete' }),
    })
    assert.equal(backupA.data.kind, 'manual')

    await api('/api/admin/feeds/' + feed.data.id, {
      method: 'DELETE',
      headers: { 'x-admin-token': token },
    })
    await api('/api/admin/backups/' + backupA.data.id + '/restore', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    })

    const feedsAfterRestore = await api<Array<{ id: string }>>('/api/admin/feeds', {
      method: 'GET',
      headers: { 'x-admin-token': token },
    })
    assert.ok(feedsAfterRestore.data.some((item) => item.id === feed.data.id), 'Feed not restored')

    const runsAfterRestore = await api<Array<{ source_id: string; action?: string }>>('/api/admin/import/runs', {
      method: 'GET',
      headers: { 'x-admin-token': token },
    })
    assert.equal(
      runsAfterRestore.data.some((item) => item.source_id === feed.data.id && item.action === 'delete'),
      false,
      'Stale delete run marker is still present',
    )

    // 5) manual backup actions are persisted to audit logs
    const backupB = await api<{ id: string }>('/api/admin/backups', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'critical-delete-check' }),
    })
    await api('/api/admin/backups/' + backupB.data.id, {
      method: 'DELETE',
      headers: { 'x-admin-token': token },
    })

    const logs = await api<{
      items: Array<{ action: string; entity: string; entity_id?: string }>
      total: number
      page: number
      limit: number
    }>('/api/admin/logs?page=1&limit=200', {
      method: 'GET',
      headers: { 'x-admin-token': token },
    })
    const hasCreateA = logs.data.items.some(
      (item) => item.entity === 'settings' && item.action === 'create' && item.entity_id === backupA.data.id,
    )
    const hasRestoreA = logs.data.items.some(
      (item) => item.entity === 'settings' && item.action === 'update' && item.entity_id === backupA.data.id,
    )
    const hasCreateB = logs.data.items.some(
      (item) => item.entity === 'settings' && item.action === 'create' && item.entity_id === backupB.data.id,
    )
    const hasDeleteB = logs.data.items.some(
      (item) => item.entity === 'settings' && item.action === 'delete' && item.entity_id === backupB.data.id,
    )
    const hasCreateFidelity = logs.data.items.some(
      (item) => item.entity === 'settings' && item.action === 'create' && item.entity_id === backupFidelity.data.id,
    )
    const hasRestoreFidelity = logs.data.items.some(
      (item) => item.entity === 'settings' && item.action === 'update' && item.entity_id === backupFidelity.data.id,
    )
    const hasCreateLeadProcessing = logs.data.items.some(
      (item) =>
        item.entity === 'settings' &&
        item.action === 'create' &&
        item.entity_id === backupLeadProcessing.data.id,
    )
    const hasUpdateLeadProcessing = logs.data.items.some(
      (item) =>
        item.entity === 'lead' &&
        item.action === 'update' &&
        item.entity_id === backupLeadProcessing.data.id,
    )
    assert.equal(hasCreateA, true, 'Missing backup create log for A')
    assert.equal(hasRestoreA, true, 'Missing backup restore log for A')
    assert.equal(hasCreateB, true, 'Missing backup create log for B')
    assert.equal(hasDeleteB, true, 'Missing backup delete log for B')
    assert.equal(hasCreateFidelity, true, 'Missing backup create log for fidelity check')
    assert.equal(hasRestoreFidelity, true, 'Missing backup restore log for fidelity check')
    assert.equal(hasCreateLeadProcessing, true, 'Missing backup create log for dedicated leads backup')
    assert.equal(hasUpdateLeadProcessing, true, 'Missing dedicated lead-processing restore audit log')

    // 6) auto backup once/day + audit create log
    const backupsDir = path.join(tempRoot, 'backups')
    await fs.mkdir(backupsDir, { recursive: true })
    for (const name of await fs.readdir(backupsDir)) {
      await fs.unlink(path.join(backupsDir, name))
    }
    storage.withDb((db) => {
      db.audit_logs = []
    })

    await backups.runDailyAutoBackupCheck()
    await backups.runDailyAutoBackupCheck()

    const autoBackupsOnce = (await backups.listBackups()).filter((item) => item.kind === 'auto')
    assert.equal(autoBackupsOnce.length, 1, 'Auto backup must be created once per day')

    const autoCreateLogs = storage.withDb((db) =>
      db.audit_logs.filter(
        (log) => log.action === 'create' && log.entity === 'settings' && log.admin_id === 'system',
      ),
    )
    assert.equal(autoCreateLogs.length, 1, 'Missing/duplicate auto backup create log')

    // 7) retention keeps latest 3 autos and logs deletions
    for (const name of await fs.readdir(backupsDir)) {
      await fs.unlink(path.join(backupsDir, name))
    }
    storage.withDb((db) => {
      db.audit_logs = []
    })

    const snapshot = storage.readDb()
    const autoPayloads = [
      { id: 'auto-old-1', created_at: dayOffsetIso(-4) },
      { id: 'auto-old-2', created_at: dayOffsetIso(-3) },
      { id: 'auto-old-3', created_at: dayOffsetIso(-2) },
      { id: 'auto-old-4', created_at: dayOffsetIso(-1) },
      { id: 'auto-old-5', created_at: dayOffsetIso(0) },
    ]
    for (const item of autoPayloads) {
      const payload = {
        version: 1,
        id: item.id,
        kind: 'auto' as const,
        label: `Daily ${item.created_at.slice(0, 10)}`,
        created_at: item.created_at,
        content: {
          home: snapshot.home,
          feed_sources: snapshot.feed_sources,
          complexes: snapshot.complexes,
          properties: snapshot.properties,
          collections: snapshot.collections,
          landing_feature_presets: snapshot.landing_feature_presets,
          hidden_landing_feature_preset_keys: snapshot.hidden_landing_feature_preset_keys,
        },
      }
      await fs.writeFile(path.join(backupsDir, `${item.id}.json`), JSON.stringify(payload, null, 2), 'utf-8')
    }

    await backups.runDailyAutoBackupCheck()

    const autosAfterRetention = (await backups.listBackups())
      .filter((item) => item.kind === 'auto')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))

    assert.equal(autosAfterRetention.length, 3, 'Retention must keep exactly 3 auto backups')
    assert.deepEqual(
      autosAfterRetention.map((item) => item.id),
      ['auto-old-5', 'auto-old-4', 'auto-old-3'],
      'Retention kept wrong auto backups',
    )

    const autoDeleteLogs = storage.withDb((db) =>
      db.audit_logs.filter(
        (log) => log.action === 'delete' && log.entity === 'settings' && log.admin_id === 'system',
      ),
    )
    assert.equal(autoDeleteLogs.length, 2, 'Retention deletion logs missing')

    // 8) scheduler start/stop idempotency
    backups.startBackupScheduler()
    backups.startBackupScheduler()
    backups.stopBackupScheduler()
    backups.stopBackupScheduler()

    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: {
            content_fidelity_restore: true,
            leads_not_overwritten_by_general_restore: true,
            dedicated_lead_processing_restore: true,
            restore_and_deleted_marker_cleanup: true,
            manual_backup_audit_logs: true,
            auto_backup_once_per_day: true,
            auto_backup_retention_three: true,
            auto_retention_audit_logs: true,
            scheduler_idempotent_start_stop: true,
          },
        },
        null,
        2,
      ),
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    backups.stopBackupScheduler()
    await storage.closeStorage()
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
