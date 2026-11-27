-- Health case lifecycle (open, monitor, resolve, close, reopen), history and notifiable-disease tracking.
-- Additive only. Use only with the approved database baseline and a verified backup.
-- If the farm row-security policies are active on this database, run farm-rls.sql (or farm-tenant-access.sql) again
-- afterwards so the new "HealthCaseEvent" table gets the farm boundary policy and grants.
-- Rollback (deletes case history): DROP TABLE public."HealthCaseEvent"; then drop the added "HealthCase" columns.
BEGIN;
ALTER TABLE public."HealthCase"
  ADD COLUMN IF NOT EXISTS "resolvedAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "outcome" text,
  ADD COLUMN IF NOT EXISTS "nextReviewAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "reopenedCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastActivityAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "notifiable" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reportedToAuthorityAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "authorityReference" text;

CREATE TABLE IF NOT EXISTS public."HealthCaseEvent" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "healthCaseId" text NOT NULL,
  "userId" text,
  "type" text NOT NULL,
  "fromStatus" text,
  "toStatus" text,
  "note" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HealthCaseEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HealthCaseEvent_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HealthCaseEvent_healthCaseId_fkey" FOREIGN KEY ("healthCaseId") REFERENCES public."HealthCase"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HealthCaseEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "HealthCaseEvent_healthCaseId_createdAt_idx" ON public."HealthCaseEvent"("healthCaseId", "createdAt");
CREATE INDEX IF NOT EXISTS "HealthCaseEvent_farmId_createdAt_idx" ON public."HealthCaseEvent"("farmId", "createdAt");
CREATE INDEX IF NOT EXISTS "HealthCase_farmId_status_nextReviewAt_idx" ON public."HealthCase"("farmId", "status", "nextReviewAt");
COMMIT;
