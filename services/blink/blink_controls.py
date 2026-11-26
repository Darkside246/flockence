"""Owner-approved Blink settings through the pinned BlinkPy adapter."""
from math import isfinite
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool


def flag(value):
    if isinstance(value, bool):
        return value
    if type(value) is int and value in (0, 1):
        return bool(value)
    return None


def number(value):
    return value if type(value) in (int, float) and isfinite(value) else None


def readings(blink):
    systems = [{"name": name, "armed": flag(sync.arm)} for name, sync in blink.sync.items()]
    cameras = []
    for name, cam in blink.cameras.items():
        data = cam.attributes
        cameras.append({
            "name": name,
            "model": data.get("type"),
            "firmware": data.get("version"),
            "battery": data.get("battery"),
            "wifiSignal": number(data.get("wifi_strength")),
            "syncSignal": number(data.get("sync_signal_strength")),
            "temperatureC": number(data.get("temperature_c")),
            "motionEnabled": flag(data.get("motion_enabled")),
            "motionDetected": flag(data.get("motion_detected")),
            "system": data.get("sync_module"),
        })
    return {"systems": systems, "cameras": cameras}


async def night_mode(camera):
    try:
        config = await camera.night_vision
        mode = config.get("illuminator_enable") if isinstance(config, dict) else None
        return mode if mode in ("on", "off", "auto") else None
    except (TypeError, KeyError, IndexError, ValueError):
        return None


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=128)


class Motion(Change):
    kind: Literal["motion"]
    enabled: StrictBool


class SystemArm(Change):
    kind: Literal["system"]
    enabled: StrictBool


class NightVision(Change):
    kind: Literal["nightVision"]
    mode: Literal["on", "off", "auto"]


BlinkChange = Annotated[Motion | SystemArm | NightVision, Field(discriminator="kind")]


async def change_setting(blink, request):
    lookup = blink.sync if isinstance(request, SystemArm) else blink.cameras
    target = lookup.get(request.name)
    if target is None:
        raise HTTPException(404, "Blink camera or system not found.")

    if isinstance(request, NightVision):
        previous = await night_mode(target)
        if previous is None:
            raise HTTPException(409, "Blink did not report support for this camera setting.")
        if previous != request.mode:
            result = await target.async_set_night_vision(request.mode)
            if result is None or await night_mode(target) != request.mode:
                raise HTTPException(409, "Blink did not confirm the night vision change.")
    else:
        previous = flag(target.arm)
        if previous is None:
            raise HTTPException(409, "Blink did not report the current setting.")
        if previous != request.enabled:
            result = await target.async_arm(request.enabled)
            if not result:
                raise HTTPException(409, "Blink did not accept the requested change.")
            await blink.refresh(force=True)
            refreshed = (blink.sync if isinstance(request, SystemArm) else blink.cameras).get(request.name)
            if refreshed is None or flag(refreshed.arm) is not request.enabled:
                raise HTTPException(409, "Blink did not confirm the requested change.")
    return {"updated": True}
