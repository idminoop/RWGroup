import type { PoolClient } from 'pg'
import type {
  AdminUser,
  AuditLog,
  Collection,
  Complex,
  DbShape,
  FeedSource,
  HomeContent,
  ImportRun,
  LandingFeaturePreset,
  Lead,
  Property,
} from '../../../shared/types.js'

export type Scope = 'draft' | 'published'

type FeedDomainData = {
  feed_sources: FeedSource[]
  import_runs: ImportRun[]
}

type CatalogDomainData = {
  complexes: Complex[]
  properties: Property[]
  collections: Collection[]
}

type AdminDomainData = {
  admin_users: AdminUser[]
  leads: Lead[]
  audit_logs: AuditLog[]
}

type LandingDomainData = {
  landing_feature_presets: LandingFeaturePreset[]
  hidden_landing_feature_preset_keys: string[]
}

function toIso(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return new Date(value as string | number).toISOString()
}

function toIsoOptional(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return toIso(value)
}

function toNumberOptional(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const normalized = value.replace(/\s/g, '').replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export class HomeRepository {
  async load(client: PoolClient, scope: Scope): Promise<HomeContent | null> {
    const result = await client.query<{ data: HomeContent }>(
      `SELECT data FROM rw_home_content WHERE scope = $1`,
      [scope]
    )
    if (result.rows.length === 0) return null
    return result.rows[0].data
  }

  async replace(client: PoolClient, scope: Scope, home: HomeContent): Promise<void> {
    await client.query(
      `INSERT INTO rw_home_content (scope, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (scope)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [scope, JSON.stringify(home)]
    )
  }
}

export class FeedRepository {
  async load(client: PoolClient, scope: Scope): Promise<FeedDomainData> {
    const feedRows = await client.query<{
      id: string
      name: string
      mode: 'upload' | 'url'
      url: string | null
      format: 'xlsx' | 'csv' | 'xml' | 'json'
      is_active: boolean
      auto_refresh: boolean | null
      refresh_interval_hours: number | null
      last_auto_refresh: Date | string | null
      mapping: Record<string, string> | null
      created_at: Date | string
    }>(
      `SELECT id, name, mode, url, format, is_active, auto_refresh, refresh_interval_hours, last_auto_refresh, mapping, created_at
       FROM rw_feed_sources
       WHERE scope = $1
       ORDER BY created_at DESC`,
      [scope]
    )

    const runRows = await client.query<{
      id: string
      source_id: string
      entity: 'property' | 'complex'
      started_at: Date | string
      finished_at: Date | string | null
      status: 'success' | 'failed' | 'partial'
      stats: { inserted: number; updated: number; hidden: number }
      error_log: string | null
      feed_name: string | null
      feed_url: string | null
      feed_file: string | null
      target_complex_id: string | null
      action: 'import' | 'preview' | 'delete' | null
    }>(
      `SELECT id, source_id, entity, started_at, finished_at, status, stats, error_log, feed_name, feed_url, feed_file, target_complex_id, action
       FROM rw_import_runs
       WHERE scope = $1
       ORDER BY started_at DESC`,
      [scope]
    )

    return {
      feed_sources: feedRows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        mode: row.mode,
        url: row.url || undefined,
        format: row.format,
        is_active: row.is_active,
        auto_refresh: row.auto_refresh ?? undefined,
        refresh_interval_hours: row.refresh_interval_hours ?? undefined,
        last_auto_refresh: toIsoOptional(row.last_auto_refresh),
        mapping: row.mapping || undefined,
        created_at: toIso(row.created_at),
      })),
      import_runs: runRows.rows.map((row) => ({
        id: row.id,
        source_id: row.source_id,
        entity: row.entity,
        started_at: toIso(row.started_at),
        finished_at: toIsoOptional(row.finished_at),
        status: row.status,
        stats: row.stats || { inserted: 0, updated: 0, hidden: 0 },
        error_log: row.error_log || undefined,
        feed_name: row.feed_name || undefined,
        feed_url: row.feed_url || undefined,
        feed_file: row.feed_file || undefined,
        target_complex_id: row.target_complex_id || undefined,
        action: row.action || undefined,
      })),
    }
  }

  async replace(client: PoolClient, scope: Scope, data: FeedDomainData): Promise<void> {
    await client.query(`DELETE FROM rw_import_runs WHERE scope = $1`, [scope])
    await client.query(`DELETE FROM rw_feed_sources WHERE scope = $1`, [scope])

    for (const feed of data.feed_sources) {
      await client.query(
        `INSERT INTO rw_feed_sources (
           scope, id, name, mode, url, format, is_active, auto_refresh, refresh_interval_hours, last_auto_refresh, mapping, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12
         )`,
        [
          scope,
          feed.id,
          feed.name,
          feed.mode,
          feed.url || null,
          feed.format,
          feed.is_active,
          feed.auto_refresh ?? null,
          feed.refresh_interval_hours ?? null,
          feed.last_auto_refresh || null,
          feed.mapping ? JSON.stringify(feed.mapping) : null,
          feed.created_at,
        ]
      )
    }

    for (const run of data.import_runs) {
      await client.query(
        `INSERT INTO rw_import_runs (
           scope, id, source_id, entity, started_at, finished_at, status, stats, error_log, feed_name, feed_url, feed_file, target_complex_id, action
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14
         )`,
        [
          scope,
          run.id,
          run.source_id,
          run.entity,
          run.started_at,
          run.finished_at || null,
          run.status,
          JSON.stringify(run.stats || { inserted: 0, updated: 0, hidden: 0 }),
          run.error_log || null,
          run.feed_name || null,
          run.feed_url || null,
          run.feed_file || null,
          run.target_complex_id || null,
          run.action || null,
        ]
      )
    }
  }
}

export class CatalogRepository {
  async load(client: PoolClient, scope: Scope): Promise<CatalogDomainData> {
    const complexRows = await client.query<{
      id: string
      source_id: string
      external_id: string
      slug: string
      title: string
      category: 'newbuild'
      district: string
      metro: string[] | null
      price_from: number | string | null
      area_from: number | string | null
      images: string[] | null
      status: 'active' | 'hidden' | 'archived'
      developer: string | null
      class: string | null
      finish_type: string | null
      handover_date: string | null
      description: string | null
      geo_lat: number | string | null
      geo_lon: number | string | null
      landing: Record<string, unknown> | null
      last_seen_at: Date | string | null
      updated_at: Date | string
    }>(
      `SELECT id, source_id, external_id, slug, title, category, district, metro, price_from, area_from, images, status, developer, class,
              finish_type, handover_date, description, geo_lat, geo_lon, landing, last_seen_at, updated_at
       FROM rw_complexes
       WHERE scope = $1
       ORDER BY updated_at DESC`,
      [scope]
    )

    const propertyRows = await client.query<{
      id: string
      source_id: string
      external_id: string
      slug: string
      lot_number: string | null
      complex_id: string | null
      complex_external_id: string | null
      deal_type: 'sale' | 'rent'
      category: 'newbuild' | 'secondary' | 'rent'
      title: string
      bedrooms: number
      price: number | string
      price_period: 'month' | null
      old_price: number | string | null
      area_total: number | string
      area_living: number | string | null
      area_kitchen: number | string | null
      district: string
      metro: string[] | null
      images: string[] | null
      status: 'active' | 'hidden' | 'archived'
      floor: number | null
      floors_total: number | null
      renovation: string | null
      is_euroflat: boolean | null
      building_section: string | null
      building_state: string | null
      ready_quarter: number | null
      built_year: number | null
      description: string | null
      last_seen_at: Date | string | null
      updated_at: Date | string
    }>(
      `SELECT id, source_id, external_id, slug, lot_number, complex_id, complex_external_id, deal_type, category, title, bedrooms, price, price_period,
              old_price, area_total, area_living, area_kitchen, district, metro, images, status, floor, floors_total, renovation, is_euroflat,
              building_section, building_state, ready_quarter, built_year, description, last_seen_at, updated_at
       FROM rw_properties
       WHERE scope = $1
       ORDER BY updated_at DESC`,
      [scope]
    )

    const collectionRows = await client.query<{
      id: string
      slug: string
      title: string
      description: string | null
      cover_image: string | null
      priority: number
      status: 'visible' | 'hidden'
      mode: 'manual' | 'auto'
      items: Collection['items'] | null
      auto_rules: Collection['auto_rules'] | null
      updated_at: Date | string
    }>(
      `SELECT id, slug, title, description, cover_image, priority, status, mode, items, auto_rules, updated_at
       FROM rw_collections
       WHERE scope = $1
       ORDER BY priority DESC, updated_at DESC`,
      [scope]
    )

    return {
      complexes: complexRows.rows.map((row) => ({
        id: row.id,
        source_id: row.source_id,
        external_id: row.external_id,
        slug: row.slug,
        title: row.title,
        category: row.category,
        district: row.district,
        metro: toStringArray(row.metro),
        price_from: toNumberOptional(row.price_from),
        area_from: toNumberOptional(row.area_from),
        images: toStringArray(row.images),
        status: row.status,
        developer: row.developer || undefined,
        class: row.class || undefined,
        finish_type: row.finish_type || undefined,
        handover_date: row.handover_date || undefined,
        description: row.description || undefined,
        geo_lat: toNumberOptional(row.geo_lat),
        geo_lon: toNumberOptional(row.geo_lon),
        landing: row.landing || undefined,
        last_seen_at: toIsoOptional(row.last_seen_at),
        updated_at: toIso(row.updated_at),
      })),
      properties: propertyRows.rows.map((row) => ({
        id: row.id,
        source_id: row.source_id,
        external_id: row.external_id,
        slug: row.slug,
        lot_number: row.lot_number || undefined,
        complex_id: row.complex_id || undefined,
        complex_external_id: row.complex_external_id || undefined,
        deal_type: row.deal_type,
        category: row.category,
        title: row.title,
        bedrooms: row.bedrooms,
        price: toNumberOptional(row.price) || 0,
        price_period: row.price_period || undefined,
        old_price: toNumberOptional(row.old_price),
        area_total: toNumberOptional(row.area_total) || 0,
        area_living: toNumberOptional(row.area_living),
        area_kitchen: toNumberOptional(row.area_kitchen),
        district: row.district,
        metro: toStringArray(row.metro),
        images: toStringArray(row.images),
        status: row.status,
        floor: row.floor ?? undefined,
        floors_total: row.floors_total ?? undefined,
        renovation: row.renovation || undefined,
        is_euroflat: row.is_euroflat ?? undefined,
        building_section: row.building_section || undefined,
        building_state: row.building_state || undefined,
        ready_quarter: row.ready_quarter ?? undefined,
        built_year: row.built_year ?? undefined,
        description: row.description || undefined,
        last_seen_at: toIsoOptional(row.last_seen_at),
        updated_at: toIso(row.updated_at),
      })),
      collections: collectionRows.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description || undefined,
        cover_image: row.cover_image || undefined,
        priority: row.priority,
        status: row.status,
        mode: row.mode,
        items: Array.isArray(row.items) ? row.items : [],
        auto_rules: row.auto_rules || undefined,
        updated_at: toIso(row.updated_at),
      })),
    }
  }

  async replace(client: PoolClient, scope: Scope, data: CatalogDomainData): Promise<void> {
    await client.query(`DELETE FROM rw_properties WHERE scope = $1`, [scope])
    await client.query(`DELETE FROM rw_complexes WHERE scope = $1`, [scope])
    await client.query(`DELETE FROM rw_collections WHERE scope = $1`, [scope])

    for (const complex of data.complexes) {
      await client.query(
        `INSERT INTO rw_complexes (
           scope, id, source_id, external_id, slug, title, category, district, metro, price_from, area_from, images, status, developer, class,
           finish_type, handover_date, description, geo_lat, geo_lon, landing, last_seen_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11, $12::text[], $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23
         )`,
        [
          scope,
          complex.id,
          complex.source_id,
          complex.external_id,
          complex.slug,
          complex.title,
          complex.category,
          complex.district,
          complex.metro || [],
          complex.price_from ?? null,
          complex.area_from ?? null,
          complex.images || [],
          complex.status,
          complex.developer || null,
          complex.class || null,
          complex.finish_type || null,
          complex.handover_date || null,
          complex.description || null,
          complex.geo_lat ?? null,
          complex.geo_lon ?? null,
          complex.landing ? JSON.stringify(complex.landing) : null,
          complex.last_seen_at || null,
          complex.updated_at,
        ]
      )
    }

    for (const property of data.properties) {
      await client.query(
        `INSERT INTO rw_properties (
           scope, id, source_id, external_id, slug, lot_number, complex_id, complex_external_id, deal_type, category, title, bedrooms, price, price_period,
           old_price, area_total, area_living, area_kitchen, district, metro, images, status, floor, floors_total, renovation, is_euroflat,
           building_section, building_state, ready_quarter, built_year, description, last_seen_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::text[], $21::text[], $22, $23, $24, $25,
           $26, $27, $28, $29, $30, $31, $32, $33
         )`,
        [
          scope,
          property.id,
          property.source_id,
          property.external_id,
          property.slug,
          property.lot_number || null,
          property.complex_id || null,
          property.complex_external_id || null,
          property.deal_type,
          property.category,
          property.title,
          property.bedrooms,
          property.price,
          property.price_period || null,
          property.old_price ?? null,
          property.area_total,
          property.area_living ?? null,
          property.area_kitchen ?? null,
          property.district,
          property.metro || [],
          property.images || [],
          property.status,
          property.floor ?? null,
          property.floors_total ?? null,
          property.renovation || null,
          property.is_euroflat ?? null,
          property.building_section || null,
          property.building_state || null,
          property.ready_quarter ?? null,
          property.built_year ?? null,
          property.description || null,
          property.last_seen_at || null,
          property.updated_at,
        ]
      )
    }

    for (const collection of data.collections) {
      await client.query(
        `INSERT INTO rw_collections (
           scope, id, slug, title, description, cover_image, priority, status, mode, items, auto_rules, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12
         )`,
        [
          scope,
          collection.id,
          collection.slug,
          collection.title,
          collection.description || null,
          collection.cover_image || null,
          collection.priority,
          collection.status,
          collection.mode,
          JSON.stringify(collection.items || []),
          collection.auto_rules ? JSON.stringify(collection.auto_rules) : null,
          collection.updated_at,
        ]
      )
    }
  }
}

export class AdminRepository {
  async load(client: PoolClient, scope: Scope): Promise<AdminDomainData> {
    const adminRows = await client.query<{
      id: string
      login: string
      password_hash: string
      roles: string[] | null
      is_active: boolean
      created_at: Date | string
      updated_at: Date | string
    }>(
      `SELECT id, login, password_hash, roles, is_active, created_at, updated_at
       FROM rw_admin_users
       WHERE scope = $1
       ORDER BY created_at DESC`,
      [scope]
    )

    const leadRows = await client.query<{
      id: string
      form_type: Lead['form_type']
      tab: 'buy' | 'sell' | null
      name: string
      phone: string
      comment: string | null
      source: Lead['source'] | null
      lead_status: Lead['lead_status'] | null
      assignee: string | null
      admin_note: string | null
      created_at: Date | string
      updated_at: Date | string | null
      ip: string | null
      user_agent: string | null
    }>(
      `SELECT id, form_type, tab, name, phone, comment, source, lead_status, assignee, admin_note, created_at, updated_at, ip, user_agent
       FROM rw_leads
       WHERE scope = $1
       ORDER BY created_at DESC`,
      [scope]
    )

    const auditRows = await client.query<{
      id: string
      admin_id: string
      admin_login: string
      action: AuditLog['action']
      entity: AuditLog['entity']
      entity_id: string | null
      description: string
      timestamp: Date | string
      details: string | null
    }>(
      `SELECT id, admin_id, admin_login, action, entity, entity_id, description, timestamp, details
       FROM rw_audit_logs
       WHERE scope = $1
       ORDER BY timestamp DESC`,
      [scope]
    )

    return {
      admin_users: adminRows.rows.map((row) => ({
        id: row.id,
        login: row.login,
        password_hash: row.password_hash,
        roles: toStringArray(row.roles) as AdminUser['roles'],
        is_active: row.is_active,
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
      })),
      leads: leadRows.rows.map((row) => ({
        id: row.id,
        form_type: row.form_type,
        tab: row.tab || undefined,
        name: row.name,
        phone: row.phone,
        comment: row.comment || undefined,
        source: row.source || { page: 'unknown' },
        lead_status: row.lead_status || undefined,
        assignee: row.assignee || undefined,
        admin_note: row.admin_note || undefined,
        created_at: toIso(row.created_at),
        updated_at: toIsoOptional(row.updated_at),
        ip: row.ip || undefined,
        user_agent: row.user_agent || undefined,
      })),
      audit_logs: auditRows.rows.map((row) => ({
        id: row.id,
        admin_id: row.admin_id,
        admin_login: row.admin_login,
        action: row.action,
        entity: row.entity,
        entity_id: row.entity_id || undefined,
        description: row.description,
        timestamp: toIso(row.timestamp),
        details: row.details || undefined,
      })),
    }
  }

  async replace(client: PoolClient, scope: Scope, data: AdminDomainData): Promise<void> {
    await client.query(`DELETE FROM rw_admin_users WHERE scope = $1`, [scope])
    await client.query(`DELETE FROM rw_leads WHERE scope = $1`, [scope])
    await client.query(`DELETE FROM rw_audit_logs WHERE scope = $1`, [scope])

    for (const user of data.admin_users) {
      await client.query(
        `INSERT INTO rw_admin_users (
           scope, id, login, password_hash, roles, is_active, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5::text[], $6, $7, $8
         )`,
        [
          scope,
          user.id,
          user.login,
          user.password_hash,
          user.roles || [],
          user.is_active,
          user.created_at,
          user.updated_at,
        ]
      )
    }

    for (const lead of data.leads) {
      await client.query(
        `INSERT INTO rw_leads (
           scope, id, form_type, tab, name, phone, comment, source, lead_status, assignee, admin_note, created_at, updated_at, ip, user_agent
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15
         )`,
        [
          scope,
          lead.id,
          lead.form_type,
          lead.tab || null,
          lead.name,
          lead.phone,
          lead.comment || null,
          JSON.stringify(lead.source || { page: 'unknown' }),
          lead.lead_status || null,
          lead.assignee || null,
          lead.admin_note || null,
          lead.created_at,
          lead.updated_at || null,
          lead.ip || null,
          lead.user_agent || null,
        ]
      )
    }

    for (const log of data.audit_logs) {
      await client.query(
        `INSERT INTO rw_audit_logs (
           scope, id, admin_id, admin_login, action, entity, entity_id, description, timestamp, details
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
         )`,
        [
          scope,
          log.id,
          log.admin_id,
          log.admin_login,
          log.action,
          log.entity,
          log.entity_id || null,
          log.description,
          log.timestamp,
          log.details || null,
        ]
      )
    }
  }
}

export class LandingRepository {
  async load(client: PoolClient, scope: Scope): Promise<LandingDomainData> {
    const presetRows = await client.query<{ key: string; title: string; image: string }>(
      `SELECT key, title, image
       FROM rw_landing_feature_presets
       WHERE scope = $1
       ORDER BY key ASC`,
      [scope]
    )

    const hiddenRows = await client.query<{ key: string }>(
      `SELECT key
       FROM rw_hidden_landing_feature_preset_keys
       WHERE scope = $1
       ORDER BY key ASC`,
      [scope]
    )

    return {
      landing_feature_presets: presetRows.rows.map((row) => ({
        key: row.key,
        title: row.title,
        image: row.image,
      })),
      hidden_landing_feature_preset_keys: hiddenRows.rows.map((row) => row.key),
    }
  }

  async replace(client: PoolClient, scope: Scope, data: LandingDomainData): Promise<void> {
    await client.query(`DELETE FROM rw_landing_feature_presets WHERE scope = $1`, [scope])
    await client.query(`DELETE FROM rw_hidden_landing_feature_preset_keys WHERE scope = $1`, [scope])

    for (const preset of data.landing_feature_presets) {
      await client.query(
        `INSERT INTO rw_landing_feature_presets (scope, key, title, image)
         VALUES ($1, $2, $3, $4)`,
        [scope, preset.key, preset.title, preset.image]
      )
    }

    for (const key of data.hidden_landing_feature_preset_keys) {
      await client.query(
        `INSERT INTO rw_hidden_landing_feature_preset_keys (scope, key)
         VALUES ($1, $2)`,
        [scope, key]
      )
    }
  }
}

export function composeDbShape(
  home: HomeContent,
  feed: FeedDomainData,
  catalog: CatalogDomainData,
  admin: AdminDomainData,
  landing: LandingDomainData,
): DbShape {
  return {
    home,
    feed_sources: feed.feed_sources,
    complexes: catalog.complexes,
    properties: catalog.properties,
    collections: catalog.collections,
    admin_users: admin.admin_users,
    leads: admin.leads,
    import_runs: feed.import_runs,
    landing_feature_presets: landing.landing_feature_presets,
    hidden_landing_feature_preset_keys: landing.hidden_landing_feature_preset_keys,
    audit_logs: admin.audit_logs,
  }
}
