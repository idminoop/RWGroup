-- Migration 005: Persistent storage for TrendAgent local feed snapshots/status.
-- This decouples local feed availability from container filesystem lifecycle.

CREATE TABLE IF NOT EXISTS rw_trendagent_local_store (
  source_id TEXT PRIMARY KEY,
  source_name TEXT,
  source_url TEXT,
  about_url TEXT,
  installed_at TIMESTAMPTZ,
  snapshot_json JSONB,
  status_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rw_trendagent_local_store_about_url
  ON rw_trendagent_local_store (about_url);

CREATE INDEX IF NOT EXISTS idx_rw_trendagent_local_store_updated_at
  ON rw_trendagent_local_store (updated_at DESC);
