#!/usr/bin/env python3
"""Send one JPEG to Flockence from a private farm gateway."""
import argparse
from datetime import datetime, timezone
from ipaddress import ip_address, ip_network
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_BYTES = 256 * 1024
TOKEN_PATTERN = re.compile(r"cg1\.[A-Za-z0-9_-]{3,64}\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}")
FARM_NETWORKS = tuple(map(ip_network, ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_private(path, maximum):
    with path.open("rb") as handle:
        if stat.S_IMODE(path.stat().st_mode) & 0o077:
            raise ValueError("Set mode 600 on the gateway credential and camera URL files.")
        value = handle.read(maximum + 1)
    if len(value) > maximum:
        raise ValueError("A gateway configuration file is too large.")
    return value.decode().strip()


def capture(path):
    url = read_private(path, 2048)
    parsed = urlsplit(url)
    address = ip_address(parsed.hostname or "")
    if parsed.scheme != "rtsp" or not any(address in network for network in FARM_NETWORKS):
        raise ValueError("Use an RTSP address on the farm's private network.")
    return capture_url(url)


def capture_url(url):
    checked = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp", "-i", url, "-map", "0:v:0",
            "-vf", "scale=640:360:force_original_aspect_ratio=decrease",
            "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "7", "-f", "image2pipe", "pipe:1",
        ],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=True,
    )
    return checked.stdout, datetime.now(timezone.utc)


def upload(token, photo, time):
    match = TOKEN_PATTERN.fullmatch(token)
    if not match:
        raise ValueError("The gateway upload credential is invalid.")
    if len(photo) > MAX_BYTES or not photo.startswith(b"\xff\xd8") or not photo.endswith(b"\xff\xd9"):
        raise ValueError("Supply a JPEG of at most 256 KiB.")
    request = Request(
        "https://flockence.com/api/camera-gateway/" + match[1] + "/frame",
        data=photo, method="PUT", headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "image/jpeg",
            "X-Captured-At": time.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        },
    )
    with build_opener(NoRedirect()).open(request, timeout=15) as response:
        print("Snapshot uploaded (HTTP " + str(response.status) + ").")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token-file", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--rtsp-file", type=Path, help="Private file containing the camera's local RTSP URL")
    source.add_argument("--jpeg", type=Path, help="JPEG captured by existing gateway software")
    source.add_argument("--local-restream", help="Operator-configured go2rtc stream name on local port 8554")
    args = parser.parse_args()
    token = read_private(args.token_file, 256)
    if args.rtsp_file:
        photo, time = capture(args.rtsp_file)
    elif args.local_restream:
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}", args.local_restream):
            raise ValueError("Use a simple local restream name.")
        photo, time = capture_url("rtsp://127.0.0.1:8554/" + args.local_restream)
    else:
        with args.jpeg.open("rb") as handle:
            photo = handle.read(MAX_BYTES + 1)
        time = datetime.fromtimestamp(args.jpeg.stat().st_mtime, timezone.utc)
    upload(token, photo, time)


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        print("Flockence rejected the snapshot (HTTP " + str(error.code) + ").", file=sys.stderr)
        raise SystemExit(1)
    except (URLError, OSError, subprocess.SubprocessError):
        print("The gateway could not capture or upload the snapshot.", file=sys.stderr)
        raise SystemExit(1)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
