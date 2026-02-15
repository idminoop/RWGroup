CREATE TABLE IF NOT EXISTS rw_storage_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  draft_updated_at TIMESTAMPTZ,
  published_updated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rw_home_content (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope)
);

CREATE TABLE IF NOT EXISTS rw_feed_sources (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  url TEXT,
  format TEXT NOT NULL,
  is_active BOOLEAN NOT NULL,
  auto_refresh BOOLEAN,
  refresh_interval_hours INTEGER,
  last_auto_refresh TIMESTAMPTZ,
  mapping JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_rw_feed_sources_scope_name ON rw_feed_sources (scope, name);

CREATE TABLE IF NOT EXISTS rw_import_runs (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  stats JSONB NOT NULL,
  error_log TEXT,
  feed_name TEXT,
  feed_url TEXT,
  feed_file TEXT,
  target_complex_id TEXT,
  action TEXT,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_rw_import_runs_scope_started_at ON rw_import_runs (scope, started_at DESC);

CREATE TABLE IF NOT EXISTS rw_complexes (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  district TEXT NOT NULL,
  metro TEXT[] NOT NULL DEFAULT '{}',
  price_from NUMERIC,
  area_from NUMERIC,
  images TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  developer TEXT,
  class TEXT,
  finish_type TEXT,
  handover_date TEXT,
  description TEXT,
  geo_lat DOUBLE PRECISION,
  geo_lon DOUBLE PRECISION,
  landing JSONB,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_rw_complexes_scope_status ON rw_complexes (scope, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rw_complexes_scope_source_external ON rw_complexes (scope, source_id, external_id);
CREATE INDEX IF NOT EXISTS idx_rw_complexes_scope_slug ON rw_complexes (scope, slug);

CREATE TABLE IF NOT EXISTS rw_properties (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  lot_number TEXT,
  complex_id TEXT,
  complex_external_id TEXT,
  deal_type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  bedrooms INTEGER NOT NULL,
  price NUMERIC NOT NULL,
  price_period TEXT,
  old_price NUMERIC,
  area_total NUMERIC NOT NULL,
  area_living NUMERIC,
  area_kitchen NUMERIC,
  district TEXT NOT NULL,
  metro TEXT[] NOT NULL DEFAULT '{}',
  images TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  floor INTEGER,
  floors_total INTEGER,
  renovation TEXT,
  is_euroflat BOOLEAN,
  building_section TEXT,
  building_state TEXT,
  ready_quarter INTEGER,
  built_year INTEGER,
  description TEXT,
  last_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_rw_properties_scope_status ON rw_properties (scope, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rw_properties_scope_source_external ON rw_properties (scope, source_id, external_id);
CREATE INDEX IF NOT EXISTS idx_rw_properties_scope_slug ON rw_properties (scope, slug);

CREATE TABLE IF NOT EXISTS rw_collections (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cover_image TEXT,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  items JSONB NOT NULL,
  auto_rules JSONB,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_rw_collections_scope_priority ON rw_collections (scope, priority DESC);
CREATE INDEX IF NOT EXISTS idx_rw_collections_scope_slug ON rw_collections (scope, slug);

CREATE TABLE IF NOT EXISTS rw_admin_users (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  login TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rw_admin_users_scope_login ON rw_admin_users (scope, login);

CREATE TABLE IF NOT EXISTS rw_leads (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  form_type TEXT NOT NULL,
  tab TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  comment TEXT,
  source JSONB NOT NULL,
  lead_status TEXT,
  assignee TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_rw_leads_scope_created_at ON rw_leads (scope, created_at DESC);

CREATE TABLE IF NOT EXISTS rw_landing_feature_presets (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  image TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS rw_hidden_landing_feature_preset_keys (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  key TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS rw_audit_logs (
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  admin_login TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  description TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  details TEXT,
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_rw_audit_logs_scope_timestamp ON rw_audit_logs (scope, timestamp DESC);
