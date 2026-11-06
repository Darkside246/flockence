-- Staging baseline. Apply in a transaction after creating the restricted,
-- non-owner flockence_tenant role. Keep the current production role unchanged.
DO $policies$
DECLARE
  item record;
  predicate text;
  farm_context text := 'NULLIF(current_setting(''app.farm_id'', true), '''')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'flockence_tenant'
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
  ) THEN
    RAISE EXCEPTION 'Create a restricted flockence_tenant role first';
  END IF;

  FOR item IN
    SELECT * FROM (VALUES
      ('Farm', 'id', NULL::text),
      ('AuditLog', 'farmId', NULL),
      ('Batch', 'farmId', NULL),
      ('BeddingPurchase', 'farmId', NULL),
      ('BiosecurityLog', 'farmId', NULL),
      ('Customer', 'farmId', NULL),
      ('DailyFlockCheck', 'farmId', NULL),
      ('DiagnosticTest', 'farmId', NULL),
      ('EggCollection', 'farmId', NULL),
      ('EggPackRun', 'farmId', NULL),
      ('Equipment', 'farmId', NULL),
      ('Expense', 'farmId', NULL),
      ('FarmTask', 'farmId', NULL),
      ('FeedPurchase', 'farmId', NULL),
      ('HealthCase', 'farmId', NULL),
      ('HealthCaseEvent', 'farmId', NULL),
      ('BirdMovement', 'farmId', NULL),
      ('WaterReading', 'farmId', NULL),
      ('HealthObservation', 'farmId', NULL),
      ('InventoryMovement', 'farmId', NULL),
      ('LayerStageEvent', 'farmId', NULL),
      ('ManureRecord', 'farmId', NULL),
      ('Product', 'farmId', NULL),
      ('ProductionPlan', 'farmId', NULL),
      ('RecurringExpense', 'farmId', NULL),
      ('Sale', 'farmId', NULL),
      ('Setting', 'farmId', NULL),
      ('StorageLocation', 'farmId', NULL),
      ('StorageTemperatureLog', 'farmId', NULL),
      ('Supplier', 'farmId', NULL),
      ('ThermometerReading', 'farmId', NULL),
      ('TransportEvent', 'farmId', NULL),
      ('TransportationExpense', 'farmId', NULL),
      ('Treatment', 'farmId', NULL),
      ('User', 'farmId', NULL),
      ('VisionMedia', 'farmId', NULL),
      ('WeatherSnapshot', 'farmId', NULL),
      ('BirdCount', 'batchId', 'Batch'),
      ('MortalityEvent', 'batchId', 'Batch'),
      ('FeedUsage', 'batchId', 'Batch'),
      ('BeddingUsage', 'batchId', 'Batch'),
      ('SlaughterEvent', 'batchId', 'Batch'),
      ('ProcessingOutput', 'batchId', 'Batch'),
      ('HouseholdConsumption', 'batchId', 'Batch'),
      ('WeightRecord', 'batchId', 'Batch'),
      ('InventoryItem', 'productId', 'Product'),
      ('SaleItem', 'saleId', 'Sale'),
      ('EggCollectionGrade', 'eggCollectionId', 'EggCollection'),
      ('EggPackInput', 'packRunId', 'EggPackRun')
    ) AS scope(table_name, owner_column, parent_table)
  LOOP
    IF pg_has_role('flockence_tenant', (
      SELECT relowner FROM pg_class WHERE oid = to_regclass(format('public.%I', item.table_name))
    ), 'MEMBER') THEN
      RAISE EXCEPTION 'flockence_tenant can assume the owner of %', item.table_name;
    END IF;

    IF item.parent_table IS NULL THEN
      predicate := format('%I = %s', item.owner_column, farm_context);
    ELSE
      predicate := format(
        'EXISTS (SELECT 1 FROM public.%I AS parent WHERE parent.id = %I.%I AND parent."farmId" = %s)',
        item.parent_table, item.table_name, item.owner_column, farm_context
      );
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS flockence_farm_access ON public.%I', item.table_name);
    EXECUTE format('DROP POLICY IF EXISTS flockence_farm_boundary ON public.%I', item.table_name);
    EXECUTE format('CREATE POLICY flockence_farm_access ON public.%I TO flockence_tenant USING (true) WITH CHECK (true)', item.table_name);
    EXECUTE format('CREATE POLICY flockence_farm_boundary ON public.%I AS RESTRICTIVE TO flockence_tenant USING (%s) WITH CHECK (%s)',
      item.table_name, predicate, predicate);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.table_name);
  END LOOP;
END
$policies$;
