"""Pure parts of the bird counter service (no web framework or model needed), so they can be tested anywhere."""
import base64

MAX_IMAGES = 3
MAX_JPEG_BYTES = 8 * 1024 * 1024


def decode_images(items):
    """JPEG bytes from base64 strings; refuses anything that is not a JPEG or is too large."""
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_IMAGES:
        raise ValueError("Send 1 to 3 pictures.")
    out = []
    for item in items:
        if not isinstance(item, str) or len(item) > MAX_JPEG_BYTES * 4 // 3 + 4:
            raise ValueError("A picture is too large.")
        data = base64.b64decode(item, validate=True)
        if not data.startswith(b"\xff\xd8\xff"):
            raise ValueError("Pictures must be JPEG.")
        out.append(data)
    return out


def boxes_from(xyxy, scores, width, height, min_score=0.25):
    """Boxes as fractions of the picture, [x1, y1, x2, y2, score], highest score first, low scores dropped."""
    out = []
    for (x1, y1, x2, y2), score in zip(xyxy, scores):
        if score < min_score or width <= 0 or height <= 0:
            continue
        box = [max(0.0, x1 / width), max(0.0, y1 / height), min(1.0, x2 / width), min(1.0, y2 / height)]
        if box[2] > box[0] and box[3] > box[1]:
            out.append([round(v, 4) for v in box] + [round(float(score), 3)])
    return sorted(out, key=lambda b: -b[4])
