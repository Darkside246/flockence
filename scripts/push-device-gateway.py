#!/usr/bin/env python3
"""Send selected Home Assistant device states from the farm to Flockence."""
import argparse
from datetime import datetime, timezone
from ipaddress import ip_address, ip_network
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

PRIVATE_NETS = tuple(map(ip_network, ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")))
TOKEN = re.compile(r"dg1\.[A-Za-z0-9_-]{3,64}\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}")
ALIAS = re.compile(r"[a-z0-9][a-z0-9_-]{0,39}")
ENTITY = re.compile(r"(sensor|binary_sensor|switch)\.[a-z0-9_]{1,100}")
DOMAINS = {
    "temperature": "sensor", "humidity": "sensor", "power": "sensor",
    "door": "binary_sensor", "leak": "binary_sensor", "switch": "switch",
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def private_text(path, limit):
    with path.open("rb") as stream:
        if stat.S_IMODE(os.fstat(stream.fileno()).st_mode) & 0o077:
            raise ValueError("Set mode 600 on the device gateway configuration and token files.")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("A device gateway file is too large.")
    return data.decode().strip()


def ha_origin(raw):
    url = urlsplit(raw)
    address = ip_address(url.hostname or "")
    if (
        url.scheme not in ("http", "https") or url.username or url.password
        or url.path not in ("", "/") or url.query or url.fragment
        or not (address.is_loopback or any(address in network for network in PRIVATE_NETS))
    ):
        raise ValueError("Use a private Home Assistant IP address and optional port.")
    return f"{url.scheme}://{url.netloc}"


def convert(kind, state):
    value = state["state"]
    if value in ("unavailable", "unknown"):
        return None
    if kind in ("door", "leak", "switch"):
        return value if value in ("on", "off") else None
    number = float(value)
    if not math.isfinite(number):
        return None
    unit = state.get("attributes", {}).get("unit_of_measurement")
    if kind == "temperature":
        if unit == "°F":
            number = (number - 32) / 1.8
        elif unit != "°C":
            return None
        return round(number, 2) if -80 <= number <= 150 else None
    if kind == "humidity":
        return round(number, 2) if unit == "%" and 0 <= number <= 100 else None
    if unit == "kW":
        number *= 1000
    elif unit != "W":
        return None
    return round(number, 2) if 0 <= number <= 1_000_000 else None


def collect(config, token, opener):
    origin = ha_origin(config["home_assistant"])
    mapping = config["devices"]
    if not isinstance(mapping, list) or not 1 <= len(mapping) <= 32:
        raise ValueError("Select between one and 32 Home Assistant entities.")
    seen = set()
    result = []
    for item in mapping:
        alias, name, kind, entity = (item[key] for key in ("id", "name", "kind", "entity"))
        match = ENTITY.fullmatch(entity)
        if not ALIAS.fullmatch(alias) or alias in seen or not 1 <= len(name.strip()) <= 48:
            raise ValueError("Use unique device IDs and readable names of up to 48 characters.")
        if not match or match[1] != DOMAINS.get(kind):
            raise ValueError("Use a Home Assistant entity that matches the selected device type.")
        seen.add(alias)
        request = Request(origin + "/api/states/" + entity, headers={"Authorization": "Bearer " + token})
        with opener.open(request, timeout=3) as response:
            data = response.read(65_537)
        if len(data) > 65_536:
            raise ValueError("A Home Assistant state response is too large.")
        try:
            value = convert(kind, json.loads(data))
        except (KeyError, TypeError, ValueError):
            value = None
        result.append({"id": alias, "name": name.strip(), "kind": kind, "value": value})
    return result


def push(token, devices, opener):
    match = TOKEN.fullmatch(token)
    if not match:
        raise ValueError("The Flockence device gateway credential is invalid.")
    observed = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    body = json.dumps({"observedAt": observed, "devices": devices}, allow_nan=False).encode()
    request = Request(
        "https://flockence.com/api/device-gateways/" + match[1],
        data=body, method="PUT",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with opener.open(request, timeout=15) as response:
        print(f"Device readings sent (HTTP {response.status}).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--ha-token", type=Path, required=True)
    parser.add_argument("--upload-token", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(private_text(args.config, 12 * 1024))
    ha_token = private_text(args.ha_token, 4096)
    upload_token = private_text(args.upload_token, 256)
    opener = build_opener(NoRedirect())
    push(upload_token, collect(config, ha_token, opener), opener)


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        print(f"A device endpoint returned HTTP {error.code}.", file=sys.stderr)
        raise SystemExit(1)
    except (URLError, OSError, KeyError, TypeError, ValueError):
        print("Could not read or send device states. Check the private configuration and connectivity.", file=sys.stderr)
        raise SystemExit(1)
