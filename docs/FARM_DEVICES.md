# Farm devices and camera access

The Devices workspace uses the same signed-in farm session as Cameras and the rest of Flockence. Normal Flockence sign-in and the existing Sign in with Oriya flow both lead to that session. Owners link or disconnect a Home Assistant gateway. Farm managers and workers can view its readings. Camera roles continue to use the camera service's existing permissions.

Provider authorization stays at the farm. Link Home Assistant once, then select the devices this farm wants to share. Any gateway can publish the documented readings format. The first supported adapter is Home Assistant, including devices it already reads from compatible vendors. Flockence receives selected readings over HTTPS and does not send device commands.

## Enable the device gateway on staging

1. Create a dedicated PostgreSQL login named flockence_device_gateway with no privileged attributes or memberships. Apply ops/postgres/device-gateway-role.sql as the Setting table owner in a restored staging database. Verify ordinary app sessions and camera gateway access in the same database.
2. Set DEVICE_GATEWAY_DATABASE_URL to that login's connection string. Set DEVICE_GATEWAY_KEY to an independent, randomly generated 32-byte secret encoded as unpadded base64url. Keep it in the encrypted secret backup. The app requires the dedicated role and the active row policy before using the device gateway pool.
3. At flockence.com, select Devices and link a Home Assistant gateway as the farm owner. Copy the upload credential once to the farm gateway. Disconnecting revokes that credential and removes the stored readings.

The device database role is restricted to device gateway settings for the transaction's farm. Camera gateway rows and normal settings remain outside that role. Latest readings are encrypted with the farm and gateway bound into the ciphertext. This setup does not enable app-wide RLS.

## Link a farm gateway

Keep the Home Assistant token in a separate mode-600 file on the farm. Use a dedicated Home Assistant account with only the access it needs, and keep the network hop private. Connect over validated HTTPS across the LAN. A gateway and Home Assistant on the same host can use HTTP on loopback. The connector makes GET requests for the selected entities and does not forward Home Assistant credentials, entity attributes, or provider API keys to Flockence.

Create a mode-600 devices.json file with the private IP of Home Assistant and only the chosen entities.

```json
{
  "home_assistant": "http://127.0.0.1:8123",
  "devices": [
    { "id": "barn-temp", "name": "Barn temperature", "kind": "temperature", "entity": "sensor.barn_temperature" },
    { "id": "water-leak", "name": "Water leak sensor", "kind": "leak", "entity": "binary_sensor.barn_leak" }
  ]
}
```

Run the sender on the farm gateway with both credential files.

```bash
python3 scripts/push-device-gateway.py --config /etc/flockence-farm/devices.json \
  --ha-token /etc/flockence-farm/home-assistant.token \
  --upload-token /etc/flockence-farm/flockence-device.token
```

The optional flockence-devices.timer and service under ops/systemd run that sender once a minute. Place the script at /opt/flockence-farm/push-device-gateway.py and the private files at the paths used by the unit. Set up this timer on the farm gateway, separate from the VPS app. An interrupted lookup leaves the last successful readings in Flockence and the Devices page flags them as stale after five minutes.

## Camera bridges

Use the existing camera flow for Blink and compatible native RTSP sources. For a reviewed go2rtc pilot, run it on the farm gateway with its RTSP listener bound to loopback port 8554 and its management API kept private. Use the source alias the operator configured. The sender reads that RTSP stream on loopback and posts a snapshot through the existing per-camera upload credential.

```bash
python3 scripts/push-camera-frame.py --token-file /etc/flockence/camera.token --local-restream barn-cam
```

Start with official camera firmware. The go2rtc pilot still requires testing the exact model and software artifact on the farm. The old docker-wyze-bridge image and firmware mirrors are outside this integration.
