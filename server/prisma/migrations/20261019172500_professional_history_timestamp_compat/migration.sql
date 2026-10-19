BEGIN;

-- PostgreSQL CURRENT_TIMESTAMP is timestamptz, while Prisma DateTime columns
-- in this schema are timestamp without time zone. Keep one UTC-normalized
-- History clock for both call sites.
CREATE OR REPLACE FUNCTION "professional_history_timestamp"(value TEXT, fallback_value TIMESTAMPTZ)
RETURNS TIMESTAMP AS $$
  SELECT "professional_history_timestamp"(value, fallback_value AT TIME ZONE 'UTC');
$$ LANGUAGE SQL STABLE;

COMMIT;
