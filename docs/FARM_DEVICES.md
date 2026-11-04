# Connecting farm devices

## Temperature sensors

Owners can connect Govee in Settings, discover devices and confirm each sensor’s temperature unit. Read now collects a reading immediately. The scheduled polling command below also reads every farm’s saved devices. Re-enter keys if AUTH_SECRET changes.

For legacy environment configuration, run on the backend with the same database and FARM_ID as Flockence. Keep GOVEE_API_KEY
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

## Dashboard and latency checks

Each signed-in viewer can assign four camera positions. Automatic positions fill around assigned cameras, including cameras discovered while the dashboard is open. Take photo requests a new image and downloads it. Update image reloads the available still. The still label reports browser load time.

Lower delay targets two segments in the HLS.js player. Smoother playback targets six. Blink transcoding targets one-second segments. RTSP copy mode and Blink copy mode depend on the camera encoder's keyframes. Native HLS browsers control their own buffering. To measure the result, use the same camera, browser and network and compare five light switches per mode with a stopwatch. The player stops retrying at the session limit or after two stalled-stream restarts.

The sidecar warns below 5 GiB free and pauses disk-intensive work below 2 GiB. Its watchdog checks the live buffer every two seconds (64 MiB default per active camera; CAMERA_LIVE_BUFFER_MIB overrides). This is a sampled limit, not a filesystem quota. For recordings, keep an independent encrypted off-server copy with an explicit retention policy and periodically restore a sample.

To prefill a daily check, add a batchIds array of verified flock IDs to the appropriate GOVEE_SENSORS entry. On today's check the operator can copy a reading polled in the last 15 minutes, with its source and polling time. Unmapped and ambiguous sensors do not generate a suggestion.

Both pen APIs now share farm-owned profiles. On first access they reconcile legacy settings under a farm lock. Different same-name profiles retain numbered names. Owners and managers can review them and remove unneeded copies. The archive filter includes closed and slaughtered flocks on demand. Empty active broiler flocks can be closed without erasing source records; layers retain their stage workflow.

## Camera services for additional farms

The installation farm uses BLINK_SIDECAR_URL and BLINK_SIDECAR_TOKEN as before. For another business, provision a separate loopback camera service with a separate data directory, unused port and unique token. Set FARM_CAMERA_SERVICES in the web server environment to a JSON object keyed by the authenticated farm ID, for example `{"farm-id":{"port":8766,"token":"<unique random token of at least 32 characters>"}}`. Restart the web server after provisioning. The farm owner can then sign in to Blink or register and test local RTSP cameras in Settings.
