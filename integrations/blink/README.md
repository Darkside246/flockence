# Flockence Blink connector and manual smoke test

The deployed camera path is the local FastAPI sidecar under `services/blink/`. This folder provides a manual connection test and compatibility tests for the shared Blink transport.

Pinned dependencies:

- `blinkpy==0.25.9`
- `curl-cffi==0.17.0`

The shared adapter is implemented in `services/blink/transport.py`. It wraps one persistent `curl_cffi.requests.AsyncSession` and exposes the asynchronous response/session interface BlinkPy uses. The default profile is `safari18_0_ios`, configurable with `BLINK_IMPERSONATE`.

## Manual connection test

Use an account you own or are authorized to administer. From this folder, create an isolated environment and install:

```bash
python -m venv .venv
# Linux/macOS
. .venv/bin/activate
# Windows PowerShell
.venv\\Scripts\\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Set `BLINK_USERNAME` and `BLINK_PASSWORD` in the environment, then run:

```bash
python example.py
```

If Blink requests MFA, the code is requested with a secure terminal prompt and completed with BlinkPy's `Blink.send_2fa_code()`. That method performs the required post-MFA URL setup, homescreen retrieval and camera setup.

## Adapter and security notes

The Safari/iOS profile is a transport compatibility setting reported to work with this signin flow. It does not guarantee access, authenticate an account, satisfy MFA, grant authorization or override provider restrictions. Blink may change its behavior at any time. Avoid repeated login attempts and aggressive polling.

Automated tests use fake responses to cover adapter compatibility and the BlinkPy 0.25.9 OAuth/MFA request sequence. They do not contact Blink and do not establish that a real account is currently accepted.
