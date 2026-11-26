import importlib.util
import io
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "push_device_gateway", Path(__file__).resolve().parents[1] / "scripts" / "push-device-gateway.py"
)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class Response(io.BytesIO):
    status = 201


class Opener:
    def __init__(self):
        self.requests = []

    def open(self, request, **_options):
        self.requests.append(request)
        return Response(b'{"state":"86","attributes":{"unit_of_measurement":"\\u00b0F","secret":"omit"}}')


class DeviceGatewayTest(unittest.TestCase):
    def test_provider_token_and_entity_details_stay_local(self):
        opener = Opener()
        config = {
            "home_assistant": "http://192.168.10.20:8123",
            "devices": [{"id": "barn", "name": "Barn", "kind": "temperature", "entity": "sensor.private_barn_temperature"}],
        }
        devices = gateway.collect(config, "private-ha-token", opener)
        self.assertEqual(devices, [{"id": "barn", "name": "Barn", "kind": "temperature", "value": 30.0}])
        token = "dg1.farm-one." + "a" * 32 + "." + "b" * 43
        gateway.push(token, devices, opener)
        source, destination = opener.requests
        self.assertEqual(source.full_url, "http://192.168.10.20:8123/api/states/sensor.private_barn_temperature")
        self.assertEqual(source.get_method(), "GET")
        self.assertEqual(source.get_header("Authorization"), "Bearer private-ha-token")
        self.assertTrue(destination.full_url.startswith("https://flockence.com/api/device-gateways/"))
        self.assertEqual(destination.get_header("Authorization"), "Bearer " + token)
        self.assertNotIn(b"private-ha-token", destination.data)
        self.assertNotIn(b"private_barn_temperature", destination.data)
        self.assertNotIn(b"secret", destination.data)
        self.assertEqual(json.loads(destination.data)["devices"], devices)

    def test_external_hosts_and_mismatched_entities_are_rejected(self):
        for address in ("https://example.test", "http://192.168.10.20/bad", "http://user@192.168.10.20"):
            with self.assertRaises(ValueError):
                gateway.ha_origin(address)
        opener = Opener()
        with self.assertRaises(ValueError):
            gateway.collect({
                "home_assistant": "http://127.0.0.1:8123",
                "devices": [{"id": "power", "name": "Power", "kind": "power", "entity": "switch.pump"}],
            }, "token", opener)
        self.assertEqual(opener.requests, [])


if __name__ == "__main__":
    unittest.main()
