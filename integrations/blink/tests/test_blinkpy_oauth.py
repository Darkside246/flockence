from __future__ import annotations

import json
import unittest
from collections import deque

from blinkpy import api
from blinkpy.auth import Auth, BlinkTwoFARequiredError
from blinkpy.helpers.constants import (
    OAUTH_AUTHORIZE_URL,
    OAUTH_2FA_VERIFY_URL,
    OAUTH_SIGNIN_URL,
    OAUTH_TOKEN_URL,
)

from services.blink.transport import CurlCffiAiohttpAdapter


class FakeResponse:
    def __init__(self, status: int, *, text: str = "", json_data=None, headers=None):
        self.status_code = status
        self.headers = headers or {}
        self.url = "https://example.invalid/"
        self.reason = "Fake response"
        self.text = text
        self.content = text.encode()
        self._json_data = json_data

    def json(self):
        if self._json_data is not None:
            return self._json_data
        return json.loads(self.text)


class QueuedSession:
    """Fake persistent HTTP session that records the full OAuth request chain."""

    def __init__(self, responses):
        self.responses = deque(responses)
        self.calls = []
        self.close_calls = 0

    async def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self.responses.popleft()

    async def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self.responses.popleft()

    async def close(self):
        self.close_calls += 1


class BlinkPyOAuthRegressionTests(unittest.IsolatedAsyncioTestCase):
    def make_auth(self, fake_session):
        adapter = CurlCffiAiohttpAdapter(session=fake_session)
        auth = Auth(
            login_data={
                "username": "operator@example.invalid",
                "password": "fake-password-not-used",
                "host": "rest-prod.immedia-semi.com",
                "region_id": "prod",
                "account_id": "fake-account",
            },
            no_prompt=True,
            session=adapter,
        )
        return auth, adapter

    async def test_full_oauth_mfa_authorization_code_and_token_exchange(self):
        signin_html = (
            '<script id="oauth-args" type="application/json">'
            '{"csrf-token":"csrf-test"}'
            "</script>"
        )
        fake = QueuedSession([
            FakeResponse(200),
            FakeResponse(200, text=signin_html),
            FakeResponse(202, text='{"tsv_state":"pending","tsv_methods":["email"]}'),
            FakeResponse(201, json_data={"status": "auth-completed"}),
            FakeResponse(
                302,
                headers={
                    "Location": "immedia-blink://applinks.blink.com/signin/callback?code=code-test&state=state-test"
                },
            ),
            FakeResponse(
                200,
                json_data={
                    "access_token": "access-test",
                    "refresh_token": "refresh-test",
                    "expires_in": 3600,
                },
            ),
            FakeResponse(
                200,
                json_data={
                    "access_token": "refreshed-access-test",
                    "refresh_token": "refreshed-refresh-test",
                    "expires_in": 3600,
                },
            ),
        ])
        auth, adapter = self.make_auth(fake)

        try:
            with self.assertRaises(BlinkTwoFARequiredError):
                await auth.startup()

            self.assertTrue(await auth.complete_2fa_login("123456"))
            self.assertEqual(auth.token, "access-test")
            self.assertEqual(auth.refresh_token, "refresh-test")
            self.assertEqual(
                [call[0] for call in fake.calls],
                ["GET", "GET", "POST", "POST", "GET", "POST"],
            )
            self.assertEqual(
                [call[1] for call in fake.calls],
                [
                    OAUTH_AUTHORIZE_URL,
                    OAUTH_SIGNIN_URL,
                    OAUTH_SIGNIN_URL,
                    OAUTH_2FA_VERIFY_URL,
                    OAUTH_AUTHORIZE_URL,
                    OAUTH_TOKEN_URL,
                ],
            )
            self.assertEqual(fake.calls[2][2]["data"]["username"], "operator@example.invalid")
            self.assertEqual(fake.calls[3][2]["data"]["2fa_code"], "123456")
            self.assertIn("code_verifier=", fake.calls[5][2]["data"])

            # Follow-on refresh must use the same adapted session as signin/MFA.
            refreshed = await api.oauth_refresh_token(
                auth, auth.refresh_token, auth.hardware_id
            )
            self.assertEqual(refreshed["access_token"], "refreshed-access-test")
            self.assertEqual(fake.calls[6][0], "POST")
            self.assertEqual(fake.calls[6][1], OAUTH_TOKEN_URL)
            self.assertIn("grant_type=refresh_token", fake.calls[6][2]["data"])
            self.assertFalse(fake.responses)
        finally:
            await adapter.close()

        self.assertEqual(fake.close_calls, 1)

    async def test_silent_empty_401_fails_once_without_retrying(self):
        signin_html = (
            '<script id="oauth-args" type="application/json">'
            '{"csrf-token":"csrf-test"}'
            "</script>"
        )
        fake = QueuedSession([
            FakeResponse(200),
            FakeResponse(200, text=signin_html),
            FakeResponse(401, text=""),
        ])
        auth, adapter = self.make_auth(fake)
        try:
            with self.assertRaises(Exception):
                await auth.startup()
            self.assertEqual(len(fake.calls), 3)
            self.assertEqual(fake.calls[-1][1], OAUTH_SIGNIN_URL)
        finally:
            await adapter.close()


if __name__ == "__main__":
    unittest.main()
