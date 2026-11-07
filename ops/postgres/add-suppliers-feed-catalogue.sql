-- Suppliers with categories and contacts, the farm's own feed catalogue and measures (scoop, pan, feeder fill), feed
-- recorded by bag, kg, lb or measure, supplier on expenses, and three indexes for the dashboard.
-- Additive only. Use only with the approved database baseline and a verified backup.
-- If the farm row-security policies are active, run farm-rls.sql (or farm-tenant-access.sql) again afterwards so
-- "FeedProduct", "FeedProductSupplier" and "FeedMeasure" get the farm boundary policy and grants.
-- Nothing existing is renamed or removed. The first time a farm opens its feed catalogue, the built-in feed list and
-- every feed name already used on its purchases are copied into it (lib/feed-catalogue.ts).
-- Rollback (deletes the catalogue and measures): DROP TABLE public."FeedProductSupplier", public."FeedMeasure",
-- public."FeedProduct"; then drop the added columns.
BEGIN;
ALTER TABLE public."Supplier"
  ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS "businessName" text,
  ADD COLUMN IF NOT EXISTS "contactPerson" text,
  ADD COLUMN IF NOT EXISTS "whatsapp" text,
  ADD COLUMN IF NOT EXISTS "email" text,
  ADD COLUMN IF NOT EXISTS "location" text,
  ADD COLUMN IF NOT EXISTS "productsSupplied" text,
  ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public."FeedPurchase" ADD COLUMN IF NOT EXISTS "feedProductId" text;
ALTER TABLE public."FeedUsage"
  ADD COLUMN IF NOT EXISTS "feedProductId" text,
  ADD COLUMN IF NOT EXISTS "enteredQuantity" decimal(12,3),
  ADD COLUMN IF NOT EXISTS "enteredUnit" text,
  ADD COLUMN IF NOT EXISTS "penId" text;
ALTER TABLE public."Expense" ADD COLUMN IF NOT EXISTS "supplierId" text;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Expense_supplierId_fkey') THEN
    ALTER TABLE public."Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES public."Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $fk$;

CREATE TABLE IF NOT EXISTS public."FeedProduct" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "brand" text NOT NULL DEFAULT '',
  "name" text NOT NULL,
  "description" text,
  "defaultBagKg" decimal(10,3),
  "preferredSupplierId" text,
  "active" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeedProduct_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeedProduct_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES public."Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS public."FeedProductSupplier" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "feedProductId" text NOT NULL,
  "supplierId" text NOT NULL,
  "bagSizeKg" decimal(10,3),
  "unitCostMinor" integer,
  CONSTRAINT "FeedProductSupplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeedProductSupplier_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeedProductSupplier_feedProductId_fkey" FOREIGN KEY ("feedProductId") REFERENCES public."FeedProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeedProductSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES public."Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS public."FeedMeasure" (
  "id" text NOT NULL,
  "farmId" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'OTHER',
  "kgPerUnit" decimal(10,4),
  "active" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedMeasure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeedMeasure_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES public."Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "FeedProduct_farmId_active_idx" ON public."FeedProduct"("farmId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "FeedProduct_farmId_brand_name_key" ON public."FeedProduct"("farmId", "brand", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "FeedProductSupplier_feedProductId_supplierId_key" ON public."FeedProductSupplier"("feedProductId", "supplierId");
CREATE UNIQUE INDEX IF NOT EXISTS "FeedMeasure_farmId_name_key" ON public."FeedMeasure"("farmId", "name");
CREATE INDEX IF NOT EXISTS "FeedPurchase_farmId_date_idx" ON public."FeedPurchase"("farmId", "date");
CREATE INDEX IF NOT EXISTS "InventoryItem_storageLocationId_status_idx" ON public."InventoryItem"("storageLocationId", "status");
CREATE INDEX IF NOT EXISTS "WeightRecord_batchId_date_idx" ON public."WeightRecord"("batchId", "date");
COMMIT;
