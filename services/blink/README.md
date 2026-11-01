# Flockence Blink sidecar

Local service that lets Flockence show Blink cameras: live view (experimental), latest pictures and stored clips. It wraps [blinkpy](https://github.com/fronzbot/blinkpy), an unofficial client for Blink's private API, so provider-side changes may break compatibility without notice.

## Run

From PowerShell on Windows:

```powershell
cd services/blink
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:BLINK_SIDECAR_TOKEN = "<long random string>"  # same value in Flockence's .env.local
$env:BLINK_IMPERSONATE = "safari18_0_ios"         # optional; this is the default
$env:BLINK_DNS_SERVERS = "1.1.1.1,8.8.8.8"       # optional; comma-separated curl_cffi DNS servers
$env:FFMPEG_PATH = "C:/path/to/ffmpeg.exe"        # only needed for live view
& .\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8765
```

On Linux, activate the environment with `source .venv/bin/activate` and run `python -m uvicorn app:app --host 127.0.0.1 --port 8765`. Set the same environment variables in the sidecar process environment.

Then sign in to Flockence, open **Cameras**, enter your Blink email and password in the **Connect Blink** card, and enter the verification code when Blink requests it.

## Blink transport compatibility

The sidecar pins **BlinkPy 0.25.9** and **curl_cffi 0.17.0**. The sidecar uses `services/blink/transport.py` as its actual HTTP session instead of creating an ordinary `aiohttp.ClientSession`. The adapter wraps one persistent `curl_cffi.requests.AsyncSession` with the default `safari18_0_ios` profile.

The same session is reused for authorize, signin, MFA verification, authorization-code exchange, token refresh and later camera requests. This preserves cookies and other session state across the OAuth process. The profile string is configurable through `BLINK_IMPERSONATE`.

### DNS configuration

Some Windows environments can resolve Blink hostnames through Windows DNS and the system `curl.exe`, while the bundled `curl_cffi` resolver returns a DNS error. The adapter therefore supports an optional comma-separated `BLINK_DNS_SERVERS` setting. For example, `1.1.1.1,8.8.8.8` selects Cloudflare and Google public DNS for this sidecar's curl_cffi session. Leave the variable unset or blank to retain curl_cffi's default resolver.

In `curl_cffi 0.17.0`, the `dns` option requires a build using c-ares. A successful request using this option on one machine does not guarantee that every OS/package build supports it. If configured DNS servers cannot be used, curl_cffi will report a transport error. Choose DNS providers permitted by your network policy. Do not hard-code resolved Blink IP addresses: these hostnames can be served by changing CDN addresses.

The reported real-account flow reached MFA, but the initial Windows default-resolver failure prevented the subsequent regional tier lookup. A diagnostic request using `BLINK_DNS_SERVERS=1.1.1.1,8.8.8.8` reached Blink and received the expected unauthenticated HTTP 401. The end-to-end account login must be repeated from a fresh sidecar process after setting the DNS variable.

The reported reproduction succeeded with BlinkPy's existing OAuth form body. This implementation does not add the optional website-only fields or change BlinkPy's request payloads. It keeps Blink's password checks and normal MFA flow intact. After MFA, BlinkPy's own `Blink.send_2fa_code()` helper performs the required URL and homescreen setup before loading cameras.

A successful transport profile or DNS diagnostic does not guarantee that Blink will accept a login in every account, region or future session.

## How to sign in from Flockence

1. Sign in to Flockence with the farm owner's account.
2. Open **Cameras**.
3. In the **Connect Blink** card, enter the email address and password used for your Blink account, then select **Connect**.
4. When Blink requests verification, enter the one-time code in the same card and select **Verify**.
5. When connection succeeds, the camera list loads. Use **Live**, **Pictures** and **Recordings** to view the available media.

The Blink password is sent only to the private, loopback camera sidecar. It is not saved. Only the resulting session/token data is persisted in `data/credentials.json`, with restrictive file permissions where supported. The one-time MFA code is not retained.

## Security and operations

- Binds to `127.0.0.1` only. Never expose the sidecar publicly; Flockence proxies it behind its own login and role checks.
- Do not add credentials or tokens to browser code, the Flockence PostgreSQL settings table, logs or Git.
- The transport profile does not remove Blink's password validation or MFA, grant account authorization, resolve account locks or override provider restrictions. Use only an account you own or administer and follow Blink's terms.
- Do not add aggressive polling or repeated automatic login retries. Respect service limits and account-security prompts.
- Live view is experimental. Blink streams stop after `BLINK_LIVE_MAX_SECONDS` (default 300) to protect camera battery.

### Outdoor 4 2K live-stream handling

The sidecar preserves the one-time `liveview_token` from Blink's Live View response in the IMMI authentication header. It also reads complete IMMI frames, skips the fixed-size audio-configuration message, and buffers video payloads until MPEG-TS packet boundaries (188 bytes) are confirmed. This avoids dropping 2K camera video chunks merely because an individual relay payload does not begin at a transport-stream sync byte.

This is a compatibility workaround around behavior in the pinned BlinkPy 0.25.9 stream implementation. It does not guarantee that every Blink-assigned relay is reachable or available. If the regional IMMI relay refuses the TCP connection, Live View still cannot start; the sidecar reports that separately from FFmpeg playlist timeouts.
- RTSP addresses and embedded camera passwords remain server-side in `data/rtsp_cameras.json`. Keep this and the media data on a private, backed-up volume.

## Validation

From the repository root:

```bash
python -m unittest discover -s integrations/blink/tests -v
python -m compileall -q integrations/blink services/blink
```

The fake-session OAuth regression test exercises BlinkPy 0.25.9's authorization, signin, silent-401, MFA, redirect-code and token-exchange behavior. It verifies the client adapter contract, not real Blink availability. A real-account sign-in and camera image retrieval are required before relying on Blink cameras for home security.

If Blink rejects signin, do not start a rapid retry loop. Confirm that the account can sign in through Blink's official app/site and check for additional account or MFA prompts. Record the HTTP status without logging credentials, tokens or codes.
