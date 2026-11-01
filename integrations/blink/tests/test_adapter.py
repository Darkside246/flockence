from __future__ import annotations

import os
import unittest
from unittest.mock import AsyncMock, patch

from integrations.blink.adapter import DEFAULT_IMPERSONATE, CurlCffiAiohttpAdapter, CurlCffiResponse


class FakeResponse:
    def __init__(self) -> None:
        self.status_code = 201
        self.headers = {"Content-Type": "application/json", "X-Test": "ok"}
        self.url = "https://example.invalid/resource"
        self.reason = "Created"
        self.content = b'{"success": true}'
        self.text = '{"success": true}'

    def json(self):
        return {"success": True}


class FakeSession:
    def __init__(self) -> None:
        self.response = FakeResponse()
        self.get_calls = []
        self.post_calls = []
        self.close_calls = 0

    async def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        return self.response

    async def post(self, url, **kwargs):
        self.post_calls.append((url, kwargs))
        return self.response

    async def close(self):
        self.close_calls += 1


class CurlCffiResponseTests(unittest.IsolatedAsyncioTestCase):
    async def test_maps_response_properties_and_async_body_methods(self):
        response = CurlCffiResponse(FakeResponse())
        self.assertEqual(response.status, 201)
        self.assertEqual(response.headers["X-Test"], "ok")
        self.assertEqual(response.url, "https://example.invalid/resource")
        self.assertEqual(response.reason, "Created")
        self.assertEqual(await response.json(), {"success": True})
        self.assertEqual(await response.text(), '{"success": true}')
        self.assertEqual(await response.read(), b'{"success": true}')


class CurlCffiAiohttpAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_and_post_delegate_and_wrap(self):
        fake = FakeSession()
        adapter = CurlCffiAiohttpAdapter(session=fake)
        get_response = await adapter.get("https://example.invalid/get", timeout=5)
        post_response = await adapter.post("https://example.invalid/post", data="x=1")
        self.assertIsInstance(get_response, CurlCffiResponse)
        self.assertIsInstance(post_response, CurlCffiResponse)
        self.assertEqual(fake.get_calls[0][1], {"timeout": 5})
        self.assertEqual(fake.post_calls[0][1], {"data": "x=1"})

    async def test_close_is_idempotent(self):
        fake = FakeSession()
        adapter = CurlCffiAiohttpAdapter(session=fake)
        await adapter.close()
        await adapter.close()
        self.assertEqual(fake.close_calls, 1)

    async def test_async_context_manager_closes_session(self):
        fake = FakeSession()
        async with CurlCffiAiohttpAdapter(session=fake):
            self.assertEqual(fake.close_calls, 0)
        self.assertEqual(fake.close_calls, 1)

    async def test_default_profile_matches_reported_blink_oauth_profile(self):
        adapter = CurlCffiAiohttpAdapter(session=FakeSession())
        self.assertEqual(adapter.impersonate, DEFAULT_IMPERSONATE)
        self.assertEqual(DEFAULT_IMPERSONATE, "safari18_0_ios")
        await adapter.close()

    async def test_configured_dns_servers_are_passed_to_curl_cffi(self):
        with patch("services.blink.transport.AsyncSession") as async_session:
            async_session.return_value.close = AsyncMock()
            adapter = CurlCffiAiohttpAdapter(dns_servers=["1.1.1.1", "8.8.8.8"])
            async_session.assert_called_once_with(
                impersonate=DEFAULT_IMPERSONATE,
                dns=["1.1.1.1", "8.8.8.8"],
            )
            await adapter.close()

    async def test_dns_servers_can_be_configured_with_environment_variable(self):
        with patch.dict(os.environ, {"BLINK_DNS_SERVERS": "1.1.1.1, 8.8.8.8"}):
            with patch("services.blink.transport.AsyncSession") as async_session:
                async_session.return_value.close = AsyncMock()
                adapter = CurlCffiAiohttpAdapter()
                async_session.assert_called_once_with(
                    impersonate=DEFAULT_IMPERSONATE,
                    dns=["1.1.1.1", "8.8.8.8"],
                )
                await adapter.close()

    async def test_blank_dns_setting_leaves_default_resolver_unchanged(self):
        with patch.dict(os.environ, {"BLINK_DNS_SERVERS": ""}):
            with patch("services.blink.transport.AsyncSession") as async_session:
                async_session.return_value.close = AsyncMock()
                adapter = CurlCffiAiohttpAdapter()
                async_session.assert_called_once_with(impersonate=DEFAULT_IMPERSONATE)
                await adapter.close()

    async def test_closed_adapter_cannot_be_reentered(self):
        fake = FakeSession()
        adapter = CurlCffiAiohttpAdapter(session=fake)
        await adapter.close()
        with self.assertRaises(RuntimeError):
            await adapter.__aenter__()


if __name__ == "__main__":
    unittest.main()
