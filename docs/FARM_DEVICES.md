# Connecting farm devices

## Temperature sensors

Run on the backend with the same database and FARM_ID as Flockence. Keep GOVEE_API_KEY
in the protected server environment. The collector only calls account discovery and
device state on api.govee.com’s openapi host. It does not issue control commands.

1. Run `node --env-file=.env scripts/govee-poll.mjs --list` to discover the SKU and
   device ID. Only devices reporting a sensorTemperature capability appear.
2. Set GOVEE_SENSORS to a JSON array in the server environment. Example for a .env file:

       GOVEE_SENSORS='[{"name":"Brooder 1","sku":"REPLACE","device":"REPLACE","unit":"F"}]'

   Confirm C or F for the API reading against the Govee app before enabling polling.
   Use the same sensor name as an existing CSV import only for the same physical sensor.
3. Run `node --env-file=.env scripts/govee-poll.mjs`. Verify one reading and its
   humidity against the app. Schedule the same command from the application directory
   every five minutes with the deployment scheduler. An offline sensor is skipped.
   The timestamp is when the backend polled the cloud; Govee may cache measurements.
   Each sensor can create one reading per minute. Review collection failures in the
   scheduler logs. No new database migration is needed.

Readings use ThermometerReading, which the existing Oriya climate summary already reads.
Farm air and refrigerated storage temperatures measure different environments.
Do not automatically assign a farm sensor reading to a cold-storage or flock check
without a verified location assignment.

## Farm cameras

In Settings > Farm cameras, choose the provider. Blink uses the existing sign-in.
The other options use an RTSP or RTSPS address. Wyze Cam v3 requires RTSP-capable
firmware or an independently installed bridge. Reolink, Amcrest and Tapo also require
a model with RTSP support. The camera service must be able to reach the address on
the farm network. Keep RTSP on a private network. Recordings remain opt-in.

Adding a camera makes it available in Flockence. The separate ORIYA_CAMERAS allowlist
controls which camera frames the farm shares with Oriya. Preserve that opt-in.

Provider references:
- https://developer.govee.com/reference/get-devices-status
- https://support.wyze.com/hc/en-us/articles/360051619871-Does-Wyze-Cam-v3-support-RTSP
- https://github.com/mrlt8/docker-wyze-bridge
