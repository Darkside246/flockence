"""Flockence bird counter: a small detector service (Vision Intelligence phase 2, 2026-11-27).

Runs on its own machine, ideally with a graphics card, so counting scales apart from the web app. The app sends up to
three JPEG pictures; the service returns one box per bird it finds in each, as fractions of the picture:
[x1, y1, x2, y2, score]. Flockence turns those into counts and still-bird checks (lib/detector-rules.mjs).

Env:
  DETECTOR_TOKEN    shared secret, 32+ characters (the app sends it as a Bearer token)
  DETECTOR_WEIGHTS  path to the trained model weights (scripts/train-bird-detector.py); without it the service says so
  DETECTOR_MIN_SCORE (optional, default 0.25)

Run:  uvicorn app:app --host 127.0.0.1 --port 8090   (behind HTTPS if it is on another machine)
The model is loaded only when weights are set, so nothing heavy is needed to run the tests.
"""
import hmac
import os
import time

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from detector_core import boxes_from, decode_images

TOKEN = os.environ.get("DETECTOR_TOKEN", "")
WEIGHTS = os.environ.get("DETECTOR_WEIGHTS", "")
MIN_SCORE = float(os.environ.get("DETECTOR_MIN_SCORE", "0.25"))


def require_token(authorization: str = Header(default="")):
    if len(TOKEN) < 32:
        raise HTTPException(503, "The detector token is not set.")
    given = authorization.removeprefix("Bearer ")
    if not hmac.compare_digest(given.encode(), TOKEN.encode()):
        raise HTTPException(401, "Not allowed.")


_model = None


def model():
    """The trained detector, loaded on first use (ultralytics YOLO; see scripts/train-bird-detector.py)."""
    global _model
    if _model is None:
        if not WEIGHTS or not os.path.isfile(WEIGHTS):
            raise HTTPException(503, "No trained weights are set (DETECTOR_WEIGHTS).")
        from ultralytics import YOLO  # only on the detector machine
        _model = YOLO(WEIGHTS)
    return _model


app = FastAPI(title="Flockence bird counter", dependencies=[Depends(require_token)], docs_url=None, redoc_url=None)


class DetectRequest(BaseModel):
    images: list[str]


@app.get("/health")
def health():
    return {"ok": True, "weights": bool(WEIGHTS and os.path.isfile(WEIGHTS))}


@app.post("/detect")
def detect(body: DetectRequest):
    try:
        pictures = decode_images(body.images)
    except ValueError as error:
        raise HTTPException(400, str(error))
    import io
    from PIL import Image  # installed with ultralytics
    detector = model()
    started = time.time()
    frames = []
    for data in pictures:
        image = Image.open(io.BytesIO(data)).convert("RGB")
        result = detector.predict(image, verbose=False, conf=MIN_SCORE, max_det=3000)[0]
        frames.append({"boxes": boxes_from(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), image.width, image.height, MIN_SCORE)})
    return {"model": os.path.basename(WEIGHTS)[:80], "frames": frames, "ms": round((time.time() - started) * 1000)}
