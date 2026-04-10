ALTER TABLE rw_complexes
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS installment_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS subsidy_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS military_mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS queue_min INTEGER,
  ADD COLUMN IF NOT EXISTS building_type TEXT;

ALTER TABLE rw_properties
  ADD COLUMN IF NOT EXISTS mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS installment_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS subsidy_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS military_mortgage_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS building_queue INTEGER,
  ADD COLUMN IF NOT EXISTS building_type TEXT;
