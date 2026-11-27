#!/usr/bin/env python3
"""Discover selected cameras from a private Wyze Bridge and sync snapshots."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess
import sys
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

sender = runpy.run_path(str(Path(__file__).with_name("push-camera-frame.py")))
STREAM = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
PAIR = re.compile(r"wb1\.[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{43}")
FEED_ID = re.compile(r"[a-f0-9]{32}")
MAX_INVENTORY = 256 * 1024
FLOCKENCE = "https://flockence.com/api/camera-gateway"
HTTP = build_opener(ProxyHandler({}), sender["NoRedirect"]())


def bridge_cameras(data):
    if not isinstance(data, dict) or not isinstance(data.get("cameras"), dict):
        raise ValueError("The private bridge did not return a signed-in camera inventory.")
    result = {}
    seen = set()
    for stream, record in data["cameras"].items():
        if not STREAM.fullmatch(stream) or not isinstance(record, dict):
            continue
        if record.get("enabled") is not True or record.get("substream") is True:
            continue
        nickname = record.get("nickname")
        label = nickname.strip()[:48] if isinstance(nickname, str) and nickname.strip() else stream[:48]
        if any(unicodedata.category(char).startswith("C") for char in label):
            label = stream[:48]
        mac = record.get("mac")
        mac = re.sub(r"[:-]", "", mac).lower() if isinstance(mac, str) else ""
        identity = "camera:" + mac if re.fullmatch("[a-f0-9]{12}", mac) else "stream:" + stream
        device = hashlib.sha256(("wyze:" + identity).encode()).hexdigest()
        if device not in seen:
            result[stream] = {"device": device, "name": label}
            seen.add(device)
    return result


def bridge_inventory(api_key):
    request = Request("http://127.0.0.1:5000/api", headers={"api": api_key, "Accept": "application/json"})
    with HTTP.open(request, timeout=10) as response:
        raw = response.read(MAX_INVENTORY + 1)
    if len(raw) > MAX_INVENTORY:
        raise ValueError("The camera inventory exceeds the supported size.")
    return bridge_cameras(json.loads(raw))


def sync_inventory(token, cameras):
    request = Request(FLOCKENCE + "/wyze", method="PUT", data=json.dumps({"cameras": cameras}).encode(), headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
    })
    with HTTP.open(request, timeout=15) as response:
        raw = response.read(8193)
    if len(raw) > 8192:
        raise ValueError("Flockence returned an oversized discovery receipt.")
    result = json.loads(raw)
    if not isinstance(result, dict) or not isinstance(result.get("feeds"), list):
        raise ValueError("Flockence did not return camera feed receipts.")
    devices = {item["device"] for item in cameras}
    seen = set()
    for receipt in result["feeds"]:
        if (not isinstance(receipt, dict) or not isinstance(receipt.get("id"), str)
                or not FEED_ID.fullmatch(receipt["id"]) or not isinstance(receipt.get("device"), str)
                or receipt["device"] not in devices or receipt["device"] in seen):
            raise ValueError("Flockence returned an invalid discovery receipt.")
        seen.add(receipt["device"])
    return result["feeds"]


def send_frame(token, feed_id, stream):
    if not FEED_ID.fullmatch(feed_id) or not STREAM.fullmatch(stream):
        raise ValueError("Invalid camera feed or stream identity.")
    photo, captured = sender["capture_url"]("rtsp://127.0.0.1:8554/" + stream)
    if (len(photo) > sender["MAX_BYTES"] or not photo.startswith(b"\xff\xd8")
            or not photo.endswith(b"\xff\xd9")):
        raise ValueError("Bridge snapshot is not a JPEG within the size limit.")
    request = Request(FLOCKENCE + "/" + feed_id + "/frame", method="PUT", data=photo, headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "image/jpeg",
        "X-Captured-At": captured.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    })
    with HTTP.open(request, timeout=15):
        pass


def sync_once(args, token, inventory):
    allowed = set(args.allow or ())
    if any(not STREAM.fullmatch(stream) for stream in allowed):
        raise ValueError("Choose valid stream names from --list.")
    selected = {stream: camera for stream, camera in inventory.items() if args.discover_all or stream in allowed}
    if len(selected) > 6:
        raise ValueError("Select up to six cameras with repeated --allow options.")
    streams = {camera["device"]: stream for stream, camera in selected.items()}
    feeds = sync_inventory(token, list(selected.values()))
    uploaded = 0
    for feed in feeds:
        try:
            send_frame(token, feed["id"], streams[feed["device"]])
            uploaded += 1
        except (ValueError, URLError, OSError, subprocess.SubprocessError):
            continue
    print(f"Selected {len(selected)}, registered {len(feeds)}, uploaded {uploaded}.", flush=True)
    if allowed - set(selected):
        print("Some selected streams were unavailable.", file=sys.stderr)
    return 0 if uploaded == len(feeds) and len(feeds) == len(selected) and not (allowed - set(selected)) else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bridge-api-file", type=Path, required=True)
    parser.add_argument("--pair-file", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--list", action="store_true")
    mode.add_argument("--allow", action="append", metavar="STREAM")
    mode.add_argument("--discover-all", action="store_true", help="Use only for a dedicated farm camera account")
    parser.add_argument("--interval-minutes", type=int, choices=range(1, 61), metavar="1–60",
                        help="Repeat discovery and snapshot capture while running")
    args = parser.parse_args()
    if args.list and args.interval_minutes:
        parser.error("--interval-minutes requires a sync mode")

    api_key = sender["read_private"](args.bridge_api_file, 256)
    if not re.fullmatch(r"[A-Za-z0-9._~+-]{12,256}", api_key):
        raise ValueError("The private bridge API key is invalid.")
    if args.list:
        for stream, camera in bridge_inventory(api_key).items():
            print(stream + "\t" + camera["name"])
        return 0
    if not args.pair_file:
        parser.error("--pair-file is required for sync")
    token = sender["read_private"](args.pair_file, 256)
    if not PAIR.fullmatch(token):
        raise ValueError("The Flockence bridge pairing key is invalid.")
    if not args.interval_minutes:
        return sync_once(args, token, bridge_inventory(api_key))
    while True:
        try:
            sync_once(args, token, bridge_inventory(api_key))
        except (ValueError, URLError, OSError):
            print("Camera sync failed. Retrying on the next interval.", file=sys.stderr)
        time.sleep(args.interval_minutes * 60)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except HTTPError as error:
        print(f"Bridge or Flockence request failed (HTTP {error.code}).", file=sys.stderr)
        raise SystemExit(1)
    except (URLError, OSError, ValueError):
        print("Could not discover or sync cameras. Check the private bridge, vault files and Flockence pairing.", file=sys.stderr)
        raise SystemExit(1)
