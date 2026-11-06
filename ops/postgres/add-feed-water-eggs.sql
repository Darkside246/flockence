-- Feed eaten vs put out, water meters and tanks, more egg categories, house at placement and how dead birds were
-- disposed of. Additive only. Use only with the approved database baseline and a verified backup.
-- If the farm row-security policies are active, run farm-rls.sql (or farm-tenant-access.sql) again afterwards so
-- "WaterReading" gets the farm boundary policy and grants.
-- Rollback (deletes water readings): DROP TABLE public."WaterReading"; then drop the added columns.
BEGIN;
ALTER TABLE public."EggCollection"
  ADD COLUMN IF NOT EXISTS "brokenEggs" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "householdEggs" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "hatchingEggs" integer NOT NULL DEFAULT 0;
ALTER TABLE public."Batch" ADD COLUMN IF NOT EXISTS "placementHouse" text;
ALTER TABLE public."MortalityEvent" ADD COLUMN IF NOT EXISTS "disposal" text;
ALTER TABLE public."FeedUsage"
  ADD COLUMN IF NOT EXISTS "leftoverKg" decimal(12,3),
  ADD COLUMN IF NOT EXISTS "spillageKg" decimal(12,3),
  ADD COLUMN IF NOT EXISTS "returnedKg" decimal(12,3);

CREATE TABLE IF NOT EXISTS public."WaterReading" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "batchId" text,
  "source" text NOT NULL,
  "kind" text NOT NULL,
  "readingL" decimal(14,3) NOT NULL,
  "addedL" decimal(14,3),
  "otherUseL" decimal(14,3),
  "readAt" timestamp(3) NOT NULL,
  "notes" text,
  "createdByUserId" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaterReading_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaterReading_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaterReading_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES public."Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WaterReading_farmId_source_readAt_idx" ON public."WaterReading"("farmId", "source", "readAt");
CREATE INDEX IF NOT EXISTS "WaterReading_batchId_readAt_idx" ON public."WaterReading"("batchId", "readAt");
COMMIT;
