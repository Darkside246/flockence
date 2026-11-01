"""Small, independently tested helpers for Blink IMMI live video."""

from __future__ import annotations

TS_PACKET_SIZE = 188
IMMI_TOKEN_FIELD_OFFSET = 34
IMMI_TOKEN_FIELD_SIZE = 64
IMMI_AUTH_HEADER_MIN_SIZE = IMMI_TOKEN_FIELD_OFFSET + IMMI_TOKEN_FIELD_SIZE


def patch_liveview_auth_header(header: bytes | bytearray, token: str | None) -> bytearray:
    """Replace BlinkPy 0.25.9's zero-filled IMMI token field with liveview_token.

    The IMMI auth header has a fixed 64-byte token field. The field length
    remains 64 and shorter tokens are null padded. A missing token preserves
    the legacy all-zero fallback for older API responses.
    """
    patched = bytearray(header)
    if len(patched) < IMMI_AUTH_HEADER_MIN_SIZE:
        raise ValueError("IMMI auth header is shorter than its token field")
    token_bytes = (token or "").encode("utf-8")[:IMMI_TOKEN_FIELD_SIZE]
    token_bytes = token_bytes.ljust(IMMI_TOKEN_FIELD_SIZE, bytes([0]))
    patched[30:34] = IMMI_TOKEN_FIELD_SIZE.to_bytes(4, byteorder="big")
    patched[IMMI_TOKEN_FIELD_OFFSET:IMMI_AUTH_HEADER_MIN_SIZE] = token_bytes
    return patched


def extract_transport_stream_packets(buffer: bytearray, incoming: bytes) -> bytes:
    """Buffer and recover complete 188-byte MPEG-TS packets across IMMI chunks.

    Blink's IMMI video payloads are not guaranteed to begin on a TS packet
    boundary. A payload may start part-way through one packet and end part-way
    through another. Preserve incomplete data and confirm sync at 188-byte
    intervals before forwarding packets to FFmpeg.
    """
    buffer.extend(incoming)
    output = bytearray()

    while True:
        sync = buffer.find(bytes([0x47]))
        if sync < 0:
            # Keep enough trailing bytes for a sync byte split across chunks.
            if len(buffer) > TS_PACKET_SIZE - 1:
                del buffer[: len(buffer) - (TS_PACKET_SIZE - 1)]
            break

        # Wait for a second complete packet to verify the MPEG-TS cadence.
        if len(buffer) < sync + (TS_PACKET_SIZE * 2):
            if sync:
                del buffer[:sync]
            break

        if buffer[sync + TS_PACKET_SIZE] != 0x47:
            del buffer[: sync + 1]
            continue

        output.extend(buffer[sync : sync + TS_PACKET_SIZE])
        del buffer[: sync + TS_PACKET_SIZE]

    return bytes(output)
