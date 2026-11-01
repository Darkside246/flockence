"""Sidecar hardening (security review 2026-11-01): constant-time token, this machine only, encrypted Blink login."""
import base64
import importlib
import json
import os
import sys
from pathlib import Path

import pytest

SIDECAR = Path(__file__).resolve().parents[3] / "services" / "blink"


def load_settings(monkeypatch, **env):
    for key in ("BLINK_SIDECAR_TOKEN", "BLINK_CREDENTIALS_KEY", "BLINK_SIDECAR_ALLOWED_CLIENTS"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.syspath_prepend(str(SIDECAR))
    sys.modules.pop("settings", None)
    return importlib.import_module("settings")


def test_token_is_required_and_compared_exactly(monkeypatch):
    from fastapi import HTTPException
    settings = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40)
    settings.require_token("t" * 40)
    for wrong in ("", "t" * 39, "t" * 41, "x" * 40):
        with pytest.raises(HTTPException):
            settings.require_token(wrong)


def test_only_this_machine_unless_listed(monkeypatch):
    settings = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40)
    assert settings.client_allowed("127.0.0.1") and settings.client_allowed("::1")
    assert not settings.client_allowed("192.168.1.20")
    assert not settings.client_allowed("10.0.0.5")
    assert not settings.client_allowed(None)
    assert not settings.client_allowed("not-an-ip")
    listed = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40, BLINK_SIDECAR_ALLOWED_CLIENTS="172.18.0.0/16")
    assert listed.client_allowed("172.18.0.3") and not listed.client_allowed("172.19.0.3")


def test_blink_login_is_encrypted_and_old_plain_file_still_reads(monkeypatch):
    key = base64.b64encode(os.urandom(32)).decode()
    settings = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40, BLINK_CREDENTIALS_KEY=key)
    attrs = {"token": "secret-blink-token", "refresh_token": "r", "account_id": 1}
    sealed = settings.seal_credentials(attrs)
    assert sealed.startswith("v1:") and "secret-blink-token" not in sealed
    assert settings.open_credentials(sealed) == (attrs, False)
    assert settings.open_credentials(json.dumps(attrs)) == (attrs, True)
    tampered = sealed[:-6] + ("A" if sealed[-6] != "A" else "B") + sealed[-5:]
    with pytest.raises(Exception):
        settings.open_credentials(tampered)
    other = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40, BLINK_CREDENTIALS_KEY=base64.b64encode(os.urandom(32)).decode())
    with pytest.raises(Exception):
        other.open_credentials(sealed)


def test_encrypted_login_without_key_is_refused_and_bad_key_rejected(monkeypatch):
    key = base64.b64encode(os.urandom(32)).decode()
    sealed = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40, BLINK_CREDENTIALS_KEY=key).seal_credentials({"token": "x"})
    nokey = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40)
    with pytest.raises(RuntimeError):
        nokey.open_credentials(sealed)
    assert nokey.seal_credentials({"token": "x"}) == '{"token": "x"}'
    bad = load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40, BLINK_CREDENTIALS_KEY="too-short")
    with pytest.raises(RuntimeError):
        bad.seal_credentials({"token": "x"})


def test_new_files_are_private(monkeypatch, tmp_path):
    load_settings(monkeypatch, BLINK_SIDECAR_TOKEN="t" * 40)
    path = tmp_path / "segment.ts"
    path.write_bytes(b"x")
    assert (path.stat().st_mode & 0o077) == 0
