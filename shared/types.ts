export type DealType = 'sale' | 'rent'
export type Category = 'newbuild' | 'secondary' | 'rent'
export type RecordStatus = 'active' | 'hidden' | 'archived'

export type FormType = 'consultation' | 'buy_sell' | 'view_details' | 'partner'
export type LeadStatus = 'new' | 'in_progress' | 'done' | 'spam'

export type CatalogTab = 'newbuild' | 'secondary' | 'rent'
export type CollectionMode = 'manual' | 'auto'

export type Id = string

export type AdminRole = 'owner' | 'content' | 'import' | 'sales'

export type AdminPermission =
  | 'admin.access'
  | 'publish.read'
  | 'publish.apply'
  | 'admin_users.read'
  | 'admin_users.write'
  | 'upload.write'
  | 'home.read'
  | 'home.write'
  | 'leads.read'
  | 'leads.write'
  | 'feeds.read'
  | 'feeds.write'
  | 'import.read'
  | 'import.write'
  | 'catalog.read'
  | 'catalog.write'
  | 'collections.read'
  | 'collections.write'
  | 'landing_presets.read'
  | 'landing_presets.write'
  | 'logs.read'

export interface AdminIdentity {
  id: Id
  login: string
  roles: AdminRole[]
  permissions: AdminPermission[]
}

export interface AdminUser {
  id: Id
  login: string
  password_hash: string
  roles: AdminRole[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AdminUserPublic {
  id: Id
  login: string
  roles: AdminRole[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ComplexLandingTag {
  id: string
  label: string
}

export interface ComplexLandingFact {
  id: string
  title: string
  value: string
  subtitle?: string
  image?: string
}

export interface ComplexLandingFeature {
  id: string
  title: string
  image?: string
  preset_key?: string
}

export interface ComplexLandingPlanItem {
  id: string
  name: string
  price: string
  area: string
  variants: number
  bedrooms?: number
  note?: string
  preview_image?: string
  preview_images?: string[]
}

export interface ComplexNearbyPlace {
  id: string
  name: string
  category?: string
  lat: number
  lon: number
  walk_minutes: number
  drive_minutes: number
  image_url?: string
  image_variants?: string[]
  image_fallback?: boolean
  image_custom?: boolean
}

export interface ComplexLandingNearby {
  enabled?: boolean
  title?: string
  subtitle?: string
  refreshed_at?: string
  selected_ids: string[]
  candidates: ComplexNearbyPlace[]
}

export interface ComplexLandingConfig {
  enabled?: boolean
  accent_color?: string
  surface_color?: string
  hero_image?: string
  preview_photo_label?: string
  cta_label?: string
  tags: ComplexLandingTag[]
  facts: ComplexLandingFact[]
  feature_ticker: ComplexLandingFeature[]
  plans: {
    title?: string
    description?: string
    cta_label?: string
    items: ComplexLandingPlanItem[]
  }
  nearby?: ComplexLandingNearby
}

export interface LandingFeaturePreset {
  key: string
  title: string
  image: string
}

export interface Complex {
  id: Id
  source_id: Id
  external_id: string
  slug: string
  title: string
  category: 'newbuild'
  district: string
  metro: string[]
  price_from?: number
  area_from?: number
  images: string[]
  status: RecordStatus
  developer?: string
  class?: string
  finish_type?: string
  handover_date?: string
  description?: string
  geo_lat?: number
  geo_lon?: number
  landing?: ComplexLandingConfig
  last_seen_at?: string
  updated_at: string
}

export interface Property {
  id: Id
  source_id: Id
  external_id: string
  slug: string
  lot_number?: string
  complex_id?: Id
  complex_external_id?: string
  deal_type: DealType
  category: Category
  title: string
  bedrooms: number
  price: number
  price_period?: 'month'
  old_price?: number
  area_total: number
  area_living?: number
  area_kitchen?: number
  district: string
  metro: string[]
  images: string[]
  status: RecordStatus
  floor?: number
  floors_total?: number
  renovation?: string
  is_euroflat?: boolean
  building_section?: string
  building_state?: string
  ready_quarter?: number
  built_year?: number
  description?: string
  last_seen_at?: string
  updated_at: string
}

export interface CollectionAutoRules {
  type: 'property' | 'complex'
  category?: Category
  bedrooms?: number
  priceMin?: number
  priceMax?: number
  areaMin?: number
  areaMax?: number
  district?: string
  metro?: string[]
  q?: string
}

export interface Collection {
  id: Id
  slug: string
  title: string
  description?: string
  cover_image?: string
  priority: number
  status: 'visible' | 'hidden'
  mode: CollectionMode
  items: { type: 'property' | 'complex'; ref_id: Id }[]
  auto_rules?: CollectionAutoRules
  updated_at: string
}

export interface Lead {
  id: Id
  form_type: FormType
  tab?: 'buy' | 'sell'
  name: string
  phone: string
  comment?: string
  source: { page: string; block?: string; object_id?: string; object_type?: 'property' | 'complex' | 'collection' }
  lead_status?: LeadStatus
  assignee?: string
  admin_note?: string
  created_at: string
  updated_at?: string
  ip?: string
  user_agent?: string
}

export interface FeedSource {
  id: Id
  name: string
  mode: 'upload' | 'url'
  url?: string
  format: 'xlsx' | 'csv' | 'xml' | 'json'
  is_active: boolean
  auto_refresh?: boolean
  refresh_interval_hours?: number
  last_auto_refresh?: string
  mapping?: Record<string, string>
  created_at: string
}

export interface ImportRun {
  id: Id
  source_id: Id
  entity: 'property' | 'complex'
  started_at: string
  finished_at?: string
  status: 'success' | 'failed' | 'partial'
  stats: { inserted: number; updated: number; hidden: number }
  error_log?: string
  feed_name?: string
  feed_url?: string
  feed_file?: string
  target_complex_id?: string
  action?: 'import' | 'preview' | 'delete'
}

export interface ImportPreviewRow {
  rowIndex: number
  data: Record<string, unknown>
  mappedFields: string[]
  errors: string[]
  warnings: string[]
}

export interface ImportPreview {
  totalRows: number
  sampleRows: ImportPreviewRow[]
  mappedItems: (Property | Complex)[]
  fieldMappings: Record<string, string[]>
  validRows: number
  invalidRows: number
}

export interface HomeContent {
  hero: {
    title: string
    subtitle: string
    address: string
    phone: string
    trust_badge?: string
    slogan_options: string[]
  }
  advantages: { title: string; description: string }[]
  pricing: { title: string; description: string; highlight?: boolean }[]
  steps: { title: string; description?: string }[]
  mission: { title: string; text: string }
  team: { title: string; founders: { name: string; role?: string; story?: string; photo_url?: string }[]; links?: { title: string; url: string }[] }
  reviews: { id: string; name: string; text: string; source_url?: string }[]
  partner: { title: string; text: string }
  featured: {
    complexes: Id[]
    properties: Id[]
    collections: Id[]
  }
  updated_at: string
}

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'publish' | 'import'
export type AuditEntity = 'property' | 'complex' | 'collection' | 'feed' | 'lead' | 'user' | 'home' | 'settings'

export interface AuditLog {
  id: Id
  admin_id: string
  admin_login: string
  action: AuditAction
  entity: AuditEntity
  entity_id?: string
  description: string
  timestamp: string
  details?: string
}

export interface DbShape {
  home: HomeContent
  feed_sources: FeedSource[]
  complexes: Complex[]
  properties: Property[]
  collections: Collection[]
  admin_users: AdminUser[]
  leads: Lead[]
  import_runs: ImportRun[]
  landing_feature_presets: LandingFeaturePreset[]
  hidden_landing_feature_preset_keys: string[]
  audit_logs: AuditLog[]
}
