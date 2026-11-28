# Wyze sign-in (cloud)

Farm owners connect Wyze under **Settings → Camera connections → Wyze → Wyze account**. They use the same steps as the Wyze app:

1. Wyze email and password.
2. If the Wyze account has two-factor turned on, the code from the authenticator app, or the code Wyze sends by text message. Wyze two-factor by email is not supported. Owners who use it switch to an app or text message in the Wyze app.

Once connected, Flockence lists the account's cameras. Farm Vision checks each camera's latest cloud picture, and the camera can be assigned to a pen like any other.

## What is stored

- The password is never stored. Wyze receives it hashed, as its own app sends it.
- After sign-in, Flockence keeps only the Wyze access and refresh tokens. They sit in the farm's `WYZE_CLOUD_V1` setting, encrypted with AES-256-GCM using a key derived from `AUTH_SECRET`.
- During a two-factor step, the hashed password waits, encrypted, for at most 10 minutes in `WYZE_CLOUD_PENDING_V1`. It is then deleted.
- Disconnect deletes both settings.
- Only owners can sign in or disconnect. Anyone allowed to view cameras sees which cameras are connected.

## Server settings (administrator, in the server `.env`)

| Setting | What it does |
| --- | --- |
| `FLOCKENCE_WYZE_CLOUD=on` | Turns Wyze sign-in on. Without it the card says Wyze is not switched on. |
| `WYZE_API_KEY_ID`, `WYZE_API_KEY` | Optional. A Wyze API key that every farm's sign-in uses, so owners only type email, password and code. See below. |
| `WYZE_MAX_PICTURE_AGE_MINUTES` | Optional, default 180. Farm Vision skips Wyze pictures older than this. |
| `FLOCKENCE_CAMERA_VISION=on` | The existing switch for Farm Vision camera checks. Wyze cameras join them when this is on. |

### The API key

Since 2024 Wyze requires an API Key ID and API key on every sign-in from an app other than its own. Keys are made at [developer-api-console.wyze.com](https://developer-api-console.wyze.com) while signed in to a Wyze account; [Wyze's guide](https://support.wyze.com/hc/en-us/articles/16129834216731-Creating-an-API-Key) shows how. The key fields only appear when they are needed:

- **Server key set:** owners see only email, password and code. If Wyze refuses the server's key for a farm's account, that owner is asked for their own key instead.
- **No server key:** owners also paste their own Key ID and key once.

Wyze describes these keys as personal, tied to the account that made them. Before relying on one server key for every farm, try it with a second Wyze account. For a sign-in Wyze fully supports for many customers, apply to Wyze as an integration partner; Alexa, Google Home and IFTTT connect that way.

## Limits

- **Picture timing:** Wyze replaces a camera's cloud picture only when the camera records an event. Pictures can be hours old, and old ones are skipped, as described above.
- **Live video:** not part of the cloud sign-in. Use the Wyze website, or the on-farm bridge in [CAMERA_GATEWAY.md](CAMERA_GATEWAY.md).
- **Unofficial interface:** the request shapes follow the open-source [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge) and [wyze-sdk](https://github.com/shauntarves/wyze-sdk) clients. They are not a published Wyze camera API, so a Wyze change can stop them working. The card then shows Wyze's message, and the rest of Flockence carries on.
