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

## Planned proactive automation
Flockence can use Oriya's existing public messaging API to send farmer alerts such as heat watches, harvest reminders, low feed, urgent health events, low cold storage capacity and outstanding customer orders.
Those proactive messages should run from a scheduled worker or cron job, not from a page view.