"""curl_cffi transport for BlinkPy 0.25.9.

BlinkPy expects an aiohttp-like async session and response interface. One
persistent AsyncSession is retained through OAuth, MFA and camera API calls.
"""
from __future__ import annotations

import os
from typing import Any

from curl_cffi.requests import AsyncSession

DEFAULT_IMPERSONATE = "safari18_0_ios"
DNS_SERVERS_ENV = "BLINK_DNS_SERVERS"


def _configured_dns_servers() -> list[str] | None:
    """Read optional comma-separated DNS servers for curl_cffi.

    An unset or blank value leaves DNS resolution to curl_cffi's normal
    resolver. Example: BLINK_DNS_SERVERS=1.1.1.1,8.8.8.8
    """
    raw = os.environ.get(DNS_SERVERS_ENV, "").strip()
    if not raw:
        return None
    servers = [server.strip() for server in raw.split(",") if server.strip()]
    return servers or None


class CurlCffiResponse:
    """Expose the subset of aiohttp.ClientResponse used by BlinkPy."""

    def __init__(self, response: Any) -> None:
        self._response = response
        status = getattr(response, "status_code", None)
        if status is None:
            status = getattr(response, "status", None)
        if status is None:
            raise TypeError("HTTP response has no status_code or status")
        self.status = int(status)
        self.headers = response.headers
        self.url = str(response.url)
        self.reason = getattr(response, "reason", "") or ""

    async def json(self) -> Any:
        return self._response.json()

    async def text(self) -> str:
        value = self._response.text
        return value() if callable(value) else value

    async def read(self) -> bytes:
        return self._response.content


class CurlCffiAiohttpAdapter:
    """Adapt curl_cffi AsyncSession to BlinkPy's async session contract."""

    def __init__(
        self,
        impersonate: str = DEFAULT_IMPERSONATE,
        *,
        session: Any | None = None,
        dns_servers: list[str] | None = None,
    ) -> None:
        if not impersonate:
            raise ValueError("A curl_cffi impersonation profile is required")
        self.impersonate = impersonate
        if session is not None:
            self._session = session
        else:
            configured_dns = dns_servers if dns_servers is not None else _configured_dns_servers()
            session_kwargs: dict[str, Any] = {"impersonate": impersonate}
            if configured_dns:
                # curl_cffi 0.17.0 supports this option in builds with c-ares.
                session_kwargs["dns"] = configured_dns
            self._session = AsyncSession(**session_kwargs)
        self._closed = False

    async def get(self, url: str, **kwargs: Any) -> CurlCffiResponse:
        return CurlCffiResponse(await self._session.get(url, **kwargs))

    async def post(self, url: str, **kwargs: Any) -> CurlCffiResponse:
        return CurlCffiResponse(await self._session.post(url, **kwargs))

    async def close(self) -> None:
        if not self._closed:
            self._closed = True
            await self._session.close()

    async def __aenter__(self) -> "CurlCffiAiohttpAdapter":
        if self._closed:
            raise RuntimeError("This Blink HTTP adapter has already been closed")
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        await self.close()
