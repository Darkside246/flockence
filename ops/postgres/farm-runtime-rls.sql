-- Run as the schema owner in staging after creating both restricted login roles.
BEGIN;
DO $role$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['flockence_customer_runtime', 'flockence_oriya_reader'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = role_name AND rolcanlogin
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
        AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = pg_roles.oid)
    ) THEN
      RAISE EXCEPTION 'Missing restricted PostgreSQL login: %', role_name;
    END IF;
  END LOOP;
END
$role$;

GRANT USAGE ON SCHEMA public TO flockence_customer_runtime, flockence_oriya_reader;
GRANT SELECT, INSERT ON public."Customer" TO flockence_customer_runtime;
GRANT SELECT ("id", "farmId", "status", "initialChicks", "startDate") ON public."Batch" TO flockence_oriya_reader;
GRANT SELECT ("id", "batchId", "liveCount", "date", "createdAt") ON public."BirdCount" TO flockence_oriya_reader;
GRANT SELECT ("id", "batchId", "quantity", "reason", "date", "createdAt") ON public."MortalityEvent" TO flockence_oriya_reader;
GRANT SELECT ("id", "batchId", "sentQuantity", "date", "createdAt") ON public."SlaughterEvent" TO flockence_oriya_reader;
GRANT SELECT ("id", "farmId", "batchId", "bagSizeKg", "quantityBags") ON public."FeedPurchase" TO flockence_oriya_reader;
GRANT SELECT ("id", "batchId", "quantityKg", "date") ON public."FeedUsage" TO flockence_oriya_reader;
GRANT SELECT ("id", "farmId", "status") ON public."HealthCase" TO flockence_oriya_reader;
GRANT SELECT ("id", "farmId", "sensor", "readAt", "temperatureC", "humidityPercent") ON public."ThermometerReading" TO flockence_oriya_reader;

DO $policies$
DECLARE
  item record;
  predicate text;
  farm_context text := 'NULLIF(current_setting(''app.farm_id'', true), '''')';
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('Customer', 'flockence_customer_runtime', NULL::text),
      ('Batch', 'flockence_oriya_reader', NULL),
      ('BirdCount', 'flockence_oriya_reader', 'Batch'),
      ('MortalityEvent', 'flockence_oriya_reader', 'Batch'),
      ('SlaughterEvent', 'flockence_oriya_reader', 'Batch'),
      ('FeedPurchase', 'flockence_oriya_reader', NULL),
      ('FeedUsage', 'flockence_oriya_reader', 'Batch'),
      ('HealthCase', 'flockence_oriya_reader', NULL),
      ('ThermometerReading', 'flockence_oriya_reader', NULL)
    ) AS target(tbl, role_name, parent)
  LOOP
    IF pg_has_role(item.role_name::name, (
      SELECT relowner FROM pg_class WHERE oid = to_regclass(format('public.%I', item.tbl))
    ), 'MEMBER') OR row_security_active(to_regclass(format('public.%I', item.tbl))) THEN
      RAISE EXCEPTION 'Verify the runtime and owner roles for %', item.tbl;
    END IF;
    IF item.parent IS NULL THEN
      predicate := format('"farmId" = %s', farm_context);
    ELSE
      predicate := format(
        'EXISTS (SELECT 1 FROM public.%I AS parent WHERE parent.id = %I."batchId" AND parent."farmId" = %s)',
        item.parent, item.tbl, farm_context
      );
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS flockence_runtime_access ON public.%I', item.tbl);
    EXECUTE format('DROP POLICY IF EXISTS flockence_runtime_boundary ON public.%I', item.tbl);
    EXECUTE format('CREATE POLICY flockence_runtime_access ON public.%I TO %I USING (true) WITH CHECK (true)', item.tbl, item.role_name);
    EXECUTE format(
      'CREATE POLICY flockence_runtime_boundary ON public.%I AS RESTRICTIVE TO %I USING (%s) WITH CHECK (%s)',
      item.tbl, item.role_name, predicate, predicate
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tbl);
  END LOOP;
END
$policies$;
COMMIT;
