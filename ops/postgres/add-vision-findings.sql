-- Vision Intelligence phase 1: findings a person checks (grouped into incidents, with review history) and the dated
-- camera-to-pen history. Additive only. Use only with the approved database baseline and a verified backup.
-- If the farm row-security policies are active, run farm-rls.sql (or farm-tenant-access.sql) again afterwards.
-- Rollback (deletes findings and camera history): DROP TABLE public."VisionFinding", public."CameraPenLink";
BEGIN;
CREATE TABLE IF NOT EXISTS public."VisionFinding" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "detail" text,
  "severity" text NOT NULL,
  "state" text NOT NULL,
  "confidence" text,
  "incidentKey" text NOT NULL,
  "penId" text,
  "penName" text,
  "batchId" text,
  "cameraName" text,
  "firstSeenAt" timestamp(3) NOT NULL,
  "lastSeenAt" timestamp(3) NOT NULL,
  "occurrences" integer NOT NULL DEFAULT 1,
  "observationId" text,
  "evidenceUrl" text,
  "history" jsonb NOT NULL DEFAULT '[]',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "VisionFinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisionFinding_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS public."CameraPenLink" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "cameraName" text NOT NULL,
  "penId" text NOT NULL,
  "fromAt" timestamp(3) NOT NULL,
  "toAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CameraPenLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CameraPenLink_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "VisionFinding_farmId_state_lastSeenAt_idx" ON public."VisionFinding"("farmId", "state", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "VisionFinding_farmId_incidentKey_lastSeenAt_idx" ON public."VisionFinding"("farmId", "incidentKey", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "VisionFinding_farmId_penId_firstSeenAt_idx" ON public."VisionFinding"("farmId", "penId", "firstSeenAt");
CREATE INDEX IF NOT EXISTS "CameraPenLink_farmId_cameraName_fromAt_idx" ON public."CameraPenLink"("farmId", "cameraName", "fromAt");
CREATE INDEX IF NOT EXISTS "CameraPenLink_farmId_penId_fromAt_idx" ON public."CameraPenLink"("farmId", "penId", "fromAt");
COMMIT;
