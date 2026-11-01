"""Manual Blink connection smoke test for an account you own or administer.

Set BLINK_USERNAME and BLINK_PASSWORD in the environment. If Blink requests
MFA, the code is requested securely in the terminal and is never saved.
"""
from __future__ import annotations

import asyncio
import getpass
import os
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from blinkpy.auth import Auth, BlinkTwoFARequiredError
from blinkpy.blinkpy import Blink

from services.blink.transport import DEFAULT_IMPERSONATE, CurlCffiAiohttpAdapter


async def main() -> int:
    username = os.environ.get("BLINK_USERNAME", "").strip()
    password = os.environ.get("BLINK_PASSWORD", "")
    if not username or not password:
        print("Set BLINK_USERNAME and BLINK_PASSWORD before running this example.", file=sys.stderr)
        return 2

    impersonate = os.environ.get("BLINK_IMPERSONATE", DEFAULT_IMPERSONATE).strip() or DEFAULT_IMPERSONATE
    session = CurlCffiAiohttpAdapter(impersonate=impersonate)
    blink = Blink(session=session)
    blink.auth = Auth(
        login_data={"username": username, "password": password},
        no_prompt=True,
        session=session,
    )

    try:
        try:
            ready = await blink.start()
        except BlinkTwoFARequiredError:
            twofa_code = getpass.getpass("Enter the Blink verification code: ").strip()
            if not twofa_code:
                print("No verification code entered.", file=sys.stderr)
                return 3
            # BlinkPy performs the required post-MFA setup in this helper.
            ready = await blink.send_2fa_code(twofa_code)

        if not ready:
            print("Blink setup did not complete. Check credentials and account status.", file=sys.stderr)
            return 5

        await blink.refresh(force=True)
        camera_names = sorted(str(name) for name in blink.cameras.keys())
        print(f"Connected to Blink. Cameras discovered: {len(camera_names)}")
        for camera_name in camera_names:
            print(f"- {camera_name}")
        return 0
    finally:
        await session.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
