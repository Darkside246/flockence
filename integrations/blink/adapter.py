"""Compatibility import for the shared Flockence Blink transport."""

from __future__ import annotations

import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from services.blink.transport import (  # noqa: E402
    DEFAULT_IMPERSONATE,
    CurlCffiAiohttpAdapter,
    CurlCffiResponse,
)

__all__ = ["DEFAULT_IMPERSONATE", "CurlCffiAiohttpAdapter", "CurlCffiResponse"]
