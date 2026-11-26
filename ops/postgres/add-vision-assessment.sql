-- Use only with the approved database baseline and a verified backup.
BEGIN;
ALTER TABLE public."HealthObservation"
  ADD COLUMN IF NOT EXISTS "visionAssessment" jsonb;
COMMIT;
