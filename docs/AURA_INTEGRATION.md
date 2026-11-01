# Flockence + Oriya integration

Flockence is the system of record for farm operations: batches, lifecycle, flock counts, weights, feed, health, slaughter, processing, inventory, pricing and orders.
Oriya is the conversational and business-intelligence layer. It can read the live Flockence catalogue, quote an order and confirm the exact quoted order after the customer clearly agrees.

## Weather
WeatherAPI.com is the initial provider. Its current Free plan lists 100,000 calls per month, realtime weather and a 3-day forecast, and its terms permit commercial use subject to attribution and other terms.
The API key stays server-side. Farm coordinates are stored in Flockence settings under weather_latitude, weather_longitude and weather_location_name.
Weather is cached for a configurable period so the dashboard does not call the provider on every render.
Weather heat status is advisory only. Flockence should compare it with actual house temperature, humidity, ventilation, water access and bird behaviour.

## Existing integration endpoints (legacy /aura route paths)
GET /api/integrations/aura/catalog
GET /api/integrations/aura/farm-summary
POST /api/integrations/aura/orders/quote
POST /api/integrations/aura/orders/confirm
GET /api/integrations/aura/orders/status?phone=...

Oriya authenticates using the existing server-side `AURA_INTEGRATION_TOKEN` compatibility variable. Keep this variable name unchanged until a coordinated credential migration is implemented.
Quote payloads are short-lived HMAC-signed tokens. Production should use AURA_QUOTE_SECRET as a separate signing secret.
Order confirmation uses an idempotency key and rechecks inventory inside a database transaction.

## Data ownership
Do not copy poultry inventory into Oriya. Oriya requests the current answer from Flockence.
Do not let the language model supply prices, inventory lot ids, customer phone numbers or delivery coordinates as trusted facts.

## Oriya is the brain (2026-11-01)

The owner decided that Flockence collects all the farm data, including the Blink pictures, and sends it to Oriya; Oriya
turns it into structured findings and alerts and sends them back. People see and use everything in Flockence; on
Oriya this is developer-only. See `docs/ORIYA_LINK.md` for the signed link, the scheduled push, the "check camera
now" request and the settings.

## Alerts

Flockence's scheduled job (`scripts/oriya-push.mjs`, run by cron, never by a page view) sends the farm numbers and
camera pictures to Oriya. Oriya's fixed rules return the alerts (deaths, low feed, heat, dead or lame birds, empty
feeders, wet litter, cameras offline) and Flockence keeps them as health observations (`ORIYA:<kind>`).
Oriya sends a WhatsApp alert itself only if its developer sets `FLOCK_ALERTS_WHATSAPP=on`.

## Status of the legacy /aura routes (checked 2026-11-01)

Oriya does not call the catalog, farm-summary or order routes above yet; they are ready on Flockence's side only.
Customer ordering of poultry through Oriya's AI (catalog, quote, confirm) needs an Oriya-side client before it works,
and should move to the signed link (per-request HMAC) rather than the shared bearer token when it is built.
