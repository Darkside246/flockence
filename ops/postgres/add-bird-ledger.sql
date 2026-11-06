-- Bird ledger: loss kinds (died, culled, missing) with corrections, birds added or moved between houses, and the
-- dressed-weight definition used for the slaughter live-weight estimate.
-- Additive only. Use only with the approved database baseline and a verified backup.
-- If the farm row-security policies are active, run farm-rls.sql (or farm-tenant-access.sql) again afterwards so
-- "BirdMovement" gets the farm boundary policy and grants.
-- Rollback (deletes added/moved bird records): DROP TABLE public."BirdMovement"; then drop the added columns.
BEGIN;
ALTER TABLE public."MortalityEvent"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'DIED',
  ADD COLUMN IF NOT EXISTS "correctedAt" timestamp(3);
ALTER TABLE public."SlaughterEvent"
  ADD COLUMN IF NOT EXISTS "dressedDefinition" text;

CREATE TABLE IF NOT EXISTS public."BirdMovement" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "batchId" text NOT NULL,
  "date" timestamp(3) NOT NULL,
  "type" text NOT NULL,
  "quantity" integer NOT NULL,
  "fromHouse" text,
  "toHouse" text,
  "source" text,
  "costMinor" integer,
  "notes" text,
  "createdByUserId" text,
  "voidedAt" timestamp(3),
  "voidReason" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BirdMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BirdMovement_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BirdMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BirdMovement_batchId_date_idx" ON public."BirdMovement"("batchId", "date");
CREATE INDEX IF NOT EXISTS "BirdMovement_farmId_date_idx" ON public."BirdMovement"("farmId", "date");
COMMIT;
