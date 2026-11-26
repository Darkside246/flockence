import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException
from pydantic import TypeAdapter, ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "services" / "blink"))
from blink_controls import BlinkChange, Motion, change_setting, readings


class CameraControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_sidecar_exposes_temperature_and_hides_provider_fields(self):
        camera = SimpleNamespace(attributes={
            "temperature_c": 28.4, "motion_enabled": True, "wifi_strength": 4,
            "serial": "private-serial", "thumbnail": "private-url",
        })
        state = readings(SimpleNamespace(sync={}, cameras={"Barn": camera}))
        self.assertEqual(state["cameras"][0]["temperatureC"], 28.4)
        self.assertIs(state["cameras"][0]["motionEnabled"], True)
        self.assertNotIn("serial", state["cameras"][0])
        self.assertNotIn("thumbnail", state["cameras"][0])

    async def test_motion_is_confirmed_before_reporting_success(self):
        camera = SimpleNamespace(arm=False, async_arm=AsyncMock(return_value={"id": 1}))
        blink = SimpleNamespace(cameras={"Barn": camera}, refresh=AsyncMock())
        change = Motion(kind="motion", name="Barn", enabled=True)
        with self.assertRaises(HTTPException):
            await change_setting(blink, change)

        async def refresh(**_options):
            camera.arm = True

        blink.refresh = refresh
        self.assertEqual(await change_setting(blink, change), {"updated": True})
        camera.async_arm.assert_awaited_with(True)

    def test_request_requires_a_boolean_and_is_registered_as_a_body(self):
        schema = TypeAdapter(BlinkChange)
        with self.assertRaises(ValidationError):
            schema.validate_python({"kind": "motion", "name": "Barn", "enabled": "false"})
        from app import app
        self.assertIn("requestBody", app.openapi()["paths"]["/blink/settings"]["post"])
