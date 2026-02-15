CREATE TABLE IF NOT EXISTS rw_app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  draft_json JSONB NOT NULL,
  published_json JSONB NOT NULL,
  draft_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rw_app_state_updated_at ON rw_app_state (updated_at);
