-- Migration: add nil_millions column to analytics.teams
BEGIN;

-- Add a nullable numeric column to hold NIL estimates in millions (e.g. 45.2)
ALTER TABLE IF EXISTS analytics.teams
  ADD COLUMN IF NOT EXISTS nil_millions numeric;

COMMIT;

-- Note: Run the complementary script `web/scripts/import_nil.mjs` to populate values
-- from the provided CSV (web/data/sideline-nil-2026.csv). The script attempts
-- exact (case-insensitive) matches then falls back to a LIKE-based heuristic.
