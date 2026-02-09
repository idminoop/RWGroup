export type DealType = 'sale' | 'rent'
export type Category = 'newbuild' | 'secondary' | 'rent'
export type RecordStatus = 'active' | 'hidden' | 'archived'

export type FormType = 'consultation' | 'buy_sell' | 'view_details' | 'partner'

export type CatalogTab = 'newbuild' | 'secondary' | 'rent'

export type CollectionMode = 'manual' | 'auto'

export type Id = string

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
  // Additional fields from XML feeds
  floor?: number
  floors_total?: number
  renovation?: string // "Предчистовая", "Под ключ", "Без отделки", etc.
  is_euroflat?: boolean
  building_section?: string
  building_state?: string // "unfinished", "built"
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
  created_at: string
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
  mapping?: Record<string, string>
  auto_refresh?: boolean
  refresh_interval_hours?: number
  last_auto_refresh?: string
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

export interface DbShape {
  home: HomeContent
  feed_sources: FeedSource[]
  complexes: Complex[]
  properties: Property[]
  collections: Collection[]
  leads: Lead[]
  import_runs: ImportRun[]
}
