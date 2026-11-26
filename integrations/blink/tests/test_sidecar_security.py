"""Regression coverage for private camera settings and encryption."""
import base64
import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.exceptions import InvalidTag
from fastapi import HTTPException

SIDECAR = Path(__file__).resolve().parents[3] / "services" / "blink"


class SidecarSecurityTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ))
        self.enterContext(patch.object(sys, "path", [str(SIDECAR), *sys.path]))
        saved = {name: sys.modules.get(name) for name in ("settings", "rtsp", "imports")}

        def restore_modules():
            for name, module in saved.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module

        self.addCleanup(restore_modules)
        self.addCleanup(os.umask, os.umask(0o077))

    def settings(self, **env):
        for key in ("BLINK_SIDECAR_TOKEN", "BLINK_CREDENTIALS_KEY", "BLINK_SIDECAR_ALLOWED_CLIENTS", "BLINK_DATA_DIR"):
            os.environ.pop(key, None)
        os.environ.update(env)
        for name in ("settings", "rtsp", "imports"):
            sys.modules.pop(name, None)
        return importlib.import_module("settings")

    def test_token_is_required_and_compared_exactly(self):
        settings = self.settings(BLINK_SIDECAR_TOKEN="t" * 40)
        settings.require_token("t" * 40)
        for wrong in ("", "t" * 39, "t" * 41, "x" * 40):
            with self.assertRaises(HTTPException):
                settings.require_token(wrong)

    def test_only_loopback_unless_listed(self):
        settings = self.settings()
        for address in ("127.0.0.1", "::1"):
            self.assertTrue(settings.client_allowed(address))
        for address in ("192.168.1.20", "10.0.0.5", None, "not-an-ip"):
            self.assertFalse(settings.client_allowed(address))
        listed = self.settings(BLINK_SIDECAR_ALLOWED_CLIENTS="172.18.0.0/16")
        self.assertTrue(listed.client_allowed("172.18.0.3"))
        self.assertFalse(listed.client_allowed("172.19.0.3"))

    def test_blink_login_uses_authenticated_encryption(self):
        key = base64.b64encode(os.urandom(32)).decode()
        settings = self.settings(BLINK_CREDENTIALS_KEY=key)
        attrs = {"token": "secret-blink-token", "refresh_token": "r", "account_id": 1}
        sealed = settings.seal_credentials(attrs)
        self.assertTrue(sealed.startswith("v1:"))
        self.assertNotIn("secret-blink-token", sealed)
        self.assertEqual(settings.open_credentials(sealed), (attrs, False))
        self.assertEqual(settings.open_credentials(json.dumps(attrs)), (attrs, True))
        data = bytearray(base64.b64decode(sealed[3:]))
        data[-1] ^= 1
        with self.assertRaises(InvalidTag):
            settings.open_credentials("v1:" + base64.b64encode(data).decode())
        other = self.settings(BLINK_CREDENTIALS_KEY=base64.b64encode(os.urandom(32)).decode())
        with self.assertRaises(InvalidTag):
            other.open_credentials(sealed)

    def test_missing_or_bad_key_refuses_encrypted_login(self):
        key = base64.b64encode(os.urandom(32)).decode()
        sealed = self.settings(BLINK_CREDENTIALS_KEY=key).seal_credentials({"token": "x"})
        no_key = self.settings()
        with self.assertRaises(RuntimeError):
            no_key.open_credentials(sealed)
        bad = self.settings(BLINK_CREDENTIALS_KEY="too-short")
        with self.assertRaises(RuntimeError):
            bad.seal_credentials({"token": "x"})

    def test_legacy_rtsp_config_becomes_private_and_cannot_be_used_as_a_blink_session(self):
        with tempfile.TemporaryDirectory() as directory:
            key = base64.b64encode(os.urandom(32)).decode()
            settings = self.settings(BLINK_CREDENTIALS_KEY=key, BLINK_DATA_DIR=directory)
            rtsp = importlib.import_module("rtsp")
            cameras = {"barn": {"url": "rtsp://user:camera-password@192.168.9.10/stream1"}}
            rtsp.STORE.write_text(json.dumps(cameras))
            rtsp.protect_saved_addresses()
            raw = rtsp.STORE.read_text()
            self.assertNotIn("camera-password", raw)
            self.assertEqual(rtsp.url_for("barn"), cameras["barn"]["url"])
            self.assertEqual(rtsp.STORE.stat().st_mode & 0o077, 0)
            with self.assertRaises(InvalidTag):
                settings.open_credentials(raw)
