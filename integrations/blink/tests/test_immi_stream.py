from __future__ import annotations

import unittest

from services.blink.immi import (
    IMMI_TOKEN_FIELD_OFFSET,
    IMMI_TOKEN_FIELD_SIZE,
    TS_PACKET_SIZE,
    extract_transport_stream_packets,
    patch_liveview_auth_header,
)


class BlinkImmiStreamTests(unittest.TestCase):
    def test_liveview_token_is_inserted_and_null_padded(self):
        original = bytearray(bytes([0xAA]) * 122)
        patched = patch_liveview_auth_header(original, "camera-session-token")

        self.assertEqual(len(patched), 122)
        self.assertEqual(patched[30:34], IMMI_TOKEN_FIELD_SIZE.to_bytes(4, "big"))
        expected = b"camera-session-token" + bytes(IMMI_TOKEN_FIELD_SIZE - len("camera-session-token"))
        self.assertEqual(
            patched[IMMI_TOKEN_FIELD_OFFSET : IMMI_TOKEN_FIELD_OFFSET + IMMI_TOKEN_FIELD_SIZE],
            expected,
        )
        self.assertEqual(original[IMMI_TOKEN_FIELD_OFFSET:98], bytes([0xAA]) * 64)

    def test_missing_token_preserves_legacy_zero_fallback(self):
        patched = patch_liveview_auth_header(bytes(122), None)
        self.assertEqual(patched[34:98], bytes(IMMI_TOKEN_FIELD_SIZE))

    def test_rejects_short_auth_header(self):
        with self.assertRaises(ValueError):
            patch_liveview_auth_header(bytes(64), "token")

    def test_recovers_packets_across_arbitrary_immi_chunk_boundaries(self):
        first = bytes([0x47]) + bytes([0x11]) * (TS_PACKET_SIZE - 1)
        second = bytes([0x47]) + bytes([0x22]) * (TS_PACKET_SIZE - 1)
        third = bytes([0x47]) + bytes([0x33]) * (TS_PACKET_SIZE - 1)
        fourth = bytes([0x47]) + bytes([0x44]) * (TS_PACKET_SIZE - 1)
        buffer = bytearray()

        out1 = extract_transport_stream_packets(buffer, b"noise" + first[:73])
        out2 = extract_transport_stream_packets(buffer, first[73:] + second + third[:41])
        out3 = extract_transport_stream_packets(buffer, third[41:] + fourth)

        self.assertEqual(out1, b"")
        self.assertEqual(out2, first)
        self.assertEqual(out3, second + third)
        self.assertLessEqual(len(buffer), TS_PACKET_SIZE * 2)

    def test_discards_misaligned_data_without_losing_next_sync(self):
        good1 = bytes([0x47]) + bytes([0x51]) * (TS_PACKET_SIZE - 1)
        good2 = bytes([0x47]) + bytes([0x52]) * (TS_PACKET_SIZE - 1)
        buffer = bytearray()
        out = extract_transport_stream_packets(buffer, bytes([0, 1]) + good1 + good2)
        self.assertEqual(out, good1)
        self.assertTrue(buffer.startswith(good2))


if __name__ == "__main__":
    unittest.main()
