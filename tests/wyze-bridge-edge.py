import runpy
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
bridge_cameras = runpy.run_path(str(ROOT / "scripts" / "sync-wyze-bridge.py"))["bridge_cameras"]


class DiscoveryTest(unittest.TestCase):
    def test_only_primary_enabled_cameras_are_listed(self):
        found = bridge_cameras({"cameras": {
            "brooder": {"enabled": True, "nickname": "Brooder", "mac": "AA:BB:CC:DD:EE:FF", "ip": "private"},
            "shell/url": {"enabled": True},
            "pro-sub": {"enabled": True, "substream": True},
            "disabled": {"enabled": False},
        }})
        self.assertEqual(list(found), ["brooder"])
        self.assertEqual(set(found["brooder"]), {"device", "name"})
        self.assertEqual(found["brooder"]["name"], "Brooder")
        self.assertEqual(len(found["brooder"]["device"]), 64)

        renamed = bridge_cameras({"cameras": {
            "hatchery": {"enabled": True, "nickname": "Hatchery", "mac": "aabbccddeeff"},
        }})
        self.assertEqual(renamed["hatchery"]["device"], found["brooder"]["device"])

    def test_missing_inventory_is_an_error(self):
        with self.assertRaises(ValueError):
            bridge_cameras({"status": "sign-in-required"})


if __name__ == "__main__":
    unittest.main()
