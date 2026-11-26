-- Run with psql against the disposable CI database.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() !~ '_test$' THEN
    RAISE EXCEPTION 'Use a disposable database ending in _test';
  END IF;
END
$guard$;
CREATE ROLE flockence_tenant NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Farm", "Customer", "Batch", "MortalityEvent" TO flockence_tenant;
\ir ../ops/postgres/farm-rls.sql

INSERT INTO "Farm" (id, name, "updatedAt") VALUES ('rls-a', 'Farm A', now()), ('rls-b', 'Farm B', now());
INSERT INTO "Customer" (id, "farmId", name) VALUES ('rls-customer-a', 'rls-a', 'Buyer A'), ('rls-customer-b', 'rls-b', 'Buyer B');
INSERT INTO "Batch" (id, "farmId", name, "traceCode", "startDate", "initialChicks", "chickCostMinor", "updatedAt")
  VALUES ('rls-batch-a', 'rls-a', 'A flock', 'rls-trace-a', now(), 10, 0, now());
INSERT INTO "MortalityEvent" (id, "batchId", date, quantity)
  VALUES ('rls-loss-a', 'rls-batch-a', now(), 1);

SET LOCAL ROLE flockence_tenant;
DO $tests$
BEGIN
  IF EXISTS (SELECT FROM "Customer") THEN RAISE EXCEPTION 'Missing scope exposed rows'; END IF;

  PERFORM set_config('app.farm_id', 'rls-a', true);
  IF (SELECT array_agg(id ORDER BY id) FROM "Customer") IS DISTINCT FROM ARRAY['rls-customer-a']::text[] THEN
    RAISE EXCEPTION 'Farm A customer visibility failed';
  END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM "MortalityEvent") IS DISTINCT FROM ARRAY['rls-loss-a']::text[] THEN
    RAISE EXCEPTION 'Farm A child visibility failed';
  END IF;
  BEGIN
    UPDATE "Customer" SET "farmId" = 'rls-b' WHERE id = 'rls-customer-a';
    RAISE EXCEPTION 'Cross-farm move succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('app.farm_id', 'rls-b', true);
  IF (SELECT array_agg(id ORDER BY id) FROM "Customer") IS DISTINCT FROM ARRAY['rls-customer-b']::text[] THEN
    RAISE EXCEPTION 'Farm B customer visibility failed';
  END IF;
  UPDATE "Customer" SET name = 'Changed' WHERE id = 'rls-customer-a';
  IF FOUND THEN RAISE EXCEPTION 'Cross-farm update succeeded'; END IF;
  DELETE FROM "Customer" WHERE id = 'rls-customer-a';
  IF FOUND THEN RAISE EXCEPTION 'Cross-farm delete succeeded'; END IF;
  IF EXISTS (SELECT FROM "MortalityEvent") THEN RAISE EXCEPTION 'Farm B read Farm A child'; END IF;
  BEGIN
    INSERT INTO "Customer" (id, "farmId", name) VALUES ('abuse', 'rls-a', 'Injected');
    RAISE EXCEPTION 'Cross-farm customer insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO "MortalityEvent" (id, "batchId", date, quantity) VALUES ('abuse', 'rls-batch-a', now(), 1);
    RAISE EXCEPTION 'Cross-farm child insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$tests$;
RESET ROLE;
ROLLBACK;
