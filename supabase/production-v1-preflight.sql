-- Read-only checks to run before applying the production V1 schema contract.
-- Any non-zero row_count below should be fixed or intentionally removed before
-- running supabase/bootstrap.sql or `pnpm --filter @workspace/db run push`.

SELECT
  'venues_missing_owner_email' AS check_name,
  COUNT(*) AS row_count
FROM venues
WHERE owner_email IS NULL OR btrim(owner_email) = '';

SELECT
  'couple_sessions_missing_couple_email' AS check_name,
  COUNT(*) AS row_count
FROM couple_sessions
WHERE couple_email IS NULL OR btrim(couple_email) = '';

SELECT
  'couple_sessions_missing_share_token' AS check_name,
  COUNT(*) AS row_count
FROM couple_sessions
WHERE share_token IS NULL OR btrim(share_token) = '';

SELECT
  'duplicate_generated_asset_object_keys' AS check_name,
  COUNT(*) AS row_count
FROM (
  SELECT object_key
  FROM generated_assets
  GROUP BY object_key
  HAVING COUNT(*) > 1
) duplicates;

SELECT
  'duplicate_generated_asset_session_slots' AS check_name,
  COUNT(*) AS row_count
FROM (
  SELECT session_id, asset_type, display_order
  FROM generated_assets
  GROUP BY session_id, asset_type, display_order
  HAVING COUNT(*) > 1
) duplicates;

SELECT
  'duplicate_upload_intent_object_keys' AS check_name,
  COUNT(*) AS row_count
FROM (
  SELECT object_key
  FROM upload_intents
  GROUP BY object_key
  HAVING COUNT(*) > 1
) duplicates;

SELECT
  'duplicate_venue_media_object_keys_per_venue' AS check_name,
  COUNT(*) AS row_count
FROM (
  SELECT venue_id, object_key
  FROM venue_media
  GROUP BY venue_id, object_key
  HAVING COUNT(*) > 1
) duplicates;

SELECT
  'venue_media_missing_or_invalid_coverage' AS check_name,
  COUNT(*) AS row_count
FROM venue_media
WHERE coverage IS NULL
   OR coverage NOT IN ('exterior', 'ceremony', 'reception', 'detail', 'natural_light');

SELECT
  'venues_missing_required_media_coverage' AS check_name,
  COUNT(*) AS row_count
FROM venues v
WHERE EXISTS (
  SELECT 1
  FROM unnest(ARRAY['exterior', 'ceremony', 'reception', 'detail', 'natural_light']) AS required_coverage(coverage)
  WHERE NOT EXISTS (
    SELECT 1
    FROM venue_media vm
    WHERE vm.venue_id = v.id
      AND vm.coverage = required_coverage.coverage
  )
);
