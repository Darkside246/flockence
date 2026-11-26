-- Install explicitly in staging as the schema owner. The camera URL must
-- authenticate directly as flockence_camera_gateway.
BEGIN;

DO $check$
DECLARE
  settings_owner oid;
  gateway oid;
BEGIN
  SELECT oid INTO gateway FROM pg_roles WHERE rolname = 'flockence_camera_gateway'
    AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
    AND NOT rolreplication;
  SELECT relowner INTO settings_owner FROM pg_class WHERE oid = 'public."Setting"'::regclass;
  IF gateway IS NULL OR pg_has_role(gateway, settings_owner, 'MEMBER') THEN
    RAISE EXCEPTION 'Use a restricted login role outside settings ownership';
  END IF;
  IF row_security_active('public."Setting"') THEN
    RAISE EXCEPTION 'The migration connection must retain access to existing settings';
  END IF;
END
$check$;

GRANT USAGE ON SCHEMA public TO flockence_camera_gateway;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."Setting" TO flockence_camera_gateway;

DROP POLICY IF EXISTS flockence_gateway_access ON public."Setting";
DROP POLICY IF EXISTS flockence_gateway_boundary ON public."Setting";
CREATE POLICY flockence_gateway_access ON public."Setting"
  TO flockence_camera_gateway USING (true) WITH CHECK (true);
CREATE POLICY flockence_gateway_boundary ON public."Setting" AS RESTRICTIVE
  TO flockence_camera_gateway
  USING (
    "farmId" = NULLIF(current_setting('app.farm_id', true), '')
    AND left("key", 16) = 'CAMERA_GATEWAY::'
  )
  WITH CHECK (
    "farmId" = NULLIF(current_setting('app.farm_id', true), '')
    AND left("key", 16) = 'CAMERA_GATEWAY::'
  );
ALTER TABLE public."Setting" ENABLE ROW LEVEL SECURITY;

COMMIT;
