-- Ensure rw_complexes has all columns expected by the codebase
-- Some deployments may have created the table via saveState() before migration 002 existed
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

-- Ensure rw_properties has all columns expected by the codebase
ALTER TABLE rw_properties
  ADD COLUMN IF NOT EXISTS built_year INTEGER,
  ADD COLUMN IF NOT EXISTS description TEXT;
