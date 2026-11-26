-- Run in restored staging with psql as the schema owner.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'flockence_tenant' AND rolcanlogin
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
      AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = pg_roles.oid)
  ) THEN RAISE EXCEPTION 'Create a restricted flockence_tenant login first'; END IF;
END
$guard$;
\ir farm-rls.sql

GRANT USAGE ON SCHEMA public TO flockence_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RateLimitBucket" TO flockence_tenant;
DO $grants$
DECLARE table_name text;
BEGIN
  FOR table_name IN SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'flockence_farm_boundary' AND 'flockence_tenant' = ANY(roles)
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO flockence_tenant', table_name);
  END LOOP;
END
$grants$;
COMMIT;
