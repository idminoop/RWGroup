-- Migration 004: Ensure all columns exist in catalog tables.
-- Fixes deployments where tables were created before migrations 002/003
-- (via saveState → createEmptyDbState).
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE rw_complexes
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS installment_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS subsidy_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS military_mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS queue_min INTEGER,
  ADD COLUMN IF NOT EXISTS building_type TEXT,
  ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS landing JSONB;

ALTER TABLE rw_properties
  ADD COLUMN IF NOT EXISTS built_year INTEGER,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS installment_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS subsidy_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS military_mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS building_queue INTEGER,
  ADD COLUMN IF NOT EXISTS building_type TEXT;
