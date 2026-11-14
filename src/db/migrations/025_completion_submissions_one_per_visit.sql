-- A Service can have exactly one accepted Report. Never choose or discard an
-- existing submission automatically if duplicate Visit identities are found.
BEGIN;

DO $$
DECLARE
  duplicate_visits text;
BEGIN
  SELECT string_agg(format('%s (%s rows)', visit_id, submission_count), ', ' ORDER BY visit_id)
    INTO duplicate_visits
  FROM (
    SELECT visit_id, count(*) AS submission_count
    FROM completion_submissions
    GROUP BY visit_id
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_visits IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add one-Report-per-Service constraint; duplicate completion_submissions visit_id values: %', duplicate_visits;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS completion_submissions_visit_id_unique_idx
  ON completion_submissions(visit_id);

DROP INDEX IF EXISTS completion_submissions_visit_id_idx;

COMMIT;
