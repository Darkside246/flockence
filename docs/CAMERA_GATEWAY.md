# Private camera snapshot gateways

Use this route for compatible Wyze RTSP cameras and other cameras on a farm LAN. The farm gateway sends one recent JPEG over HTTPS. The VPS does not connect to camera LAN addresses. Wyze Web View handles supported live viewing and Wyze login separately.

## Server prerequisites

1. In a restored staging database, provision a PostgreSQL login named flockence_camera_gateway with no superuser, bypass-RLS, database creation, replication, or role-creation privileges. It must have no role memberships. Run ops/postgres/camera-gateway-role.sql as the Setting table owner. The normal Prisma role must still own or have explicitly verified access to Setting. Installing this policy enables RLS on Setting, so verify ordinary sign-in, reset, invitations, and integrations with the actual app role before production.
2. Set CAMERA_GATEWAY_DATABASE_URL to the restricted role's own connection string, with TLS when the database connection leaves the host. Set CAMERA_GATEWAY_KEY to 32 random bytes encoded as unpadded base64url. Keep the key in the app's secret storage and encrypted backup. It is independent of the app session key.
3. Sign in as an owner, go to Cameras, pick Wyze or Other network cameras, and create a snapshot feed. Put its upload credential, displayed once, into a mode-600 file on the farm's gateway. Removing the feed deletes its stored snapshot and revokes the credential.

The application rejects gateway data operations if the configured connection is not the dedicated role or the named restricting policy is missing. Other app tables and roles are unchanged by the gateway code. This does not activate production-wide RLS.

## Farm gateway

Keep the gateway on the camera LAN, with outbound HTTPS to flockence.com and an accurate clock. For RTSP-compatible models, use the camera's RTSP URL from its local setup and save it separately in a mode-600 file. Run the sender under a private service account. FFmpeg must be available for RTSP capture. The camera URL is passed to the local FFmpeg process, so use a gateway that does not expose process arguments to other customers or users.

```bash
python3 scripts/push-camera-frame.py --token-file /etc/flockence/camera.token --rtsp-file /etc/flockence/camera.rtsp
```

A gateway that already produces JPEG files can instead use the latest file. Its modification time must reflect when the file was captured.

```bash
python3 scripts/push-camera-frame.py --token-file /etc/flockence/camera.token --jpeg /var/lib/farm-camera/latest.jpg
```

The service keeps only the latest snapshot per feed. Each farm can register six feeds. Uploads are capped at eight per minute per feed and 256 KiB. If automating, schedule at a modest interval such as one to five minutes. Keep the feed credential private and revoke it by removing the feed when replacing or decommissioning a gateway.
