# Blink settings and runtime row security

Blink settings uses the existing private Flockence camera worker. Signed-in camera viewers can see the readings a device reports. Owners can arm a Blink system, change motion detection, and select night vision on compatible models. Changes require the Flockence browser origin and are recorded as requested actions in the farm audit log. Flockence checks Blink's reported state before showing success. Temperature is a camera sensor reading. Display units are stored in the browser. Recording periods filter available clips and do not extend Blink or local retention.

The worker update and web update must be staged together for settings to work. Use an owned Blink camera to confirm permissions, readouts, and each supported setting before rollout. Older workers continue to serve their existing camera routes. New controls use the pinned BlinkPy adapter and do not require blink2video as a dependency.

## PostgreSQL stage

Create restricted login roles named flockence_customer_runtime and flockence_oriya_reader in a restored staging database. Apply ops/postgres/farm-runtime-rls.sql as the schema owner, and verify the normal application connection can still access its required tables. Set CUSTOMER_RLS_DATABASE_URL and ORIYA_RLS_DATABASE_URL to the corresponding connections. The configured pool validates its login and row policies before executing work. Farm scope is transaction-local and comes from the authenticated request or Oriya integration.

The Customer API uses the customer role to list and create records. Oriya's flock and climate summaries use a separate, read-only role with grants for the specific table columns they use. That role cannot read customer records or account settings. Oriya continues to receive the existing signed summaries and farm-approved camera frames. Camera temperatures are not inserted into the thermometer data sent to Oriya.

An unset role URL keeps the existing application-scoped path during staging. A configured role fails closed if its policy checks fail. Other operational routes, account bootstrap and cross-farm administration still require their own rollout through the tenant runtime roles.
