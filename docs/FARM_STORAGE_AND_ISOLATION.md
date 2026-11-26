# Farm records, database isolation and Blink retention

## PostgreSQL

Start with a restored copy on the VPS. Use the schema owner to run
`ops/postgres/farm-tenant-access.sql` after creating a dedicated LOGIN role
named `flockence_tenant`. Give it a unique password and no role memberships,
ownership, superuser or BYPASSRLS privileges. Configure its URL as
`FARM_RLS_DATABASE_URL` in the Flockence service environment. Use the same
database as `DATABASE_URL`.

With this option enabled, normal farm queries and transactions use that
role and bind the verified farm for the duration of the transaction. A
missing policy or incorrect runtime role fails the request. Authentication
lookup, owner bootstrap and deliberate system administration still use the
privileged database connection. Keep database credentials server-side.
Customer and Oriya restricted connections retain their separate grants and
policies. Apply `ops/postgres/farm-runtime-rls.sql` again on an existing
restricted Oriya installation to grant its reader the temperature source
column. Test sign-in, scope isolation and farm operations in staging before
enabling the tenant URL in production.

## Blink clip archive

Set `BLINK_ARCHIVE_CAMERAS` in the farm camera worker environment to a JSON
array of exact Blink camera names. It defaults to disabled. Restart the
camera worker to reload its settings. The worker checks its Blink cloud
media feed every five minutes. Local USB recordings are outside this feed.
The first scan looks back up to seven days, bounded by the configured
retention. Cameras → Recordings lists the archived clips and offers an MP4
download and a CSV index. Each worker stores its private files under
`BLINK_DATA_DIR/archives`; the archive is not in the public web root.

`BLINK_ARCHIVE_KEEP_DAYS` defaults to 30 days and
`BLINK_ARCHIVE_MAX_MIB` to 1024 MiB per worker. At the storage cap, copying
pauses until clips expire. Back up this private directory in addition to
PostgreSQL if you need recordings in a restore. Apply your usual encrypted
backup and retention policy to both copies.

## Oriya temperatures

On the production Flockence side, an existing default-farm Oriya camera
link can opt in with `ORIYA_BLINK_TEMPERATURES=on`. The
`ORIYA_CAMERAS` aliases determine which cameras are included in the next
scheduled Oriya push. Samples use degrees Celsius and record when Flockence
observed the reading. Cameras without a supported valid reading are
omitted. Removing an alias or disabling the option stops sharing its
readings. Reports → Export temperatures CSV includes stored readings and
their sources.

## Portable farm download

Reports → Download all farm records exports an owner-only versioned JSON
file containing the farm and operational tables. Record IDs and foreign
keys are preserved. Timestamps are ISO 8601, decimals use strings to retain
precision, and monetary integer fields keep the units encoded by their
names. Existing spreadsheet exports remain available. Use these downloads
for portability and analysis. They read current data in pages and do not
replace PostgreSQL point-in-time backups. User credentials, private
integration settings, audit logs and media files are excluded. Download
archive media separately from Cameras → Recordings.
