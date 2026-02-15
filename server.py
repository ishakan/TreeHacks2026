import os
import uuid
import asyncio
import logging
import traceback
from pathlib import Path
from threading import Thread
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Form, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse
from PIL import Image
import cv2
import httpx
import io
import json
import base64
import modal
import numpy as np
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="TRELLIS.2 Image-to-3D")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global state ──────────────────────────────────────────────────────
REPLICATE_API_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
REPLICATE_MODEL = "firtoz/trellis"

jobs: dict = {}

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

# ── Image Segmentation (Modal) ────────────────────────────────────────
@app.post("/api/segment")
async def segment_image(
    file: UploadFile = File(...),
    classes: str | None = Form(None),
):
    """Segment an image using Grounded SAM on Modal.

    - file: uploaded image (PNG/JPG/WebP)
    - classes: optional comma-separated class names (e.g. "cup, plate")
    Returns a list of base64-encoded PNG images, each containing one
    masked object on a transparent background.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    image_bytes = await file.read()
    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024} MB)")

    # Parse classes — default to generic prompt if not provided
    if classes:
        class_list = [c.strip() for c in classes.split(",") if c.strip()]
    else:
        class_list = ["object"]

    # Call Modal
    try:
        GroundedSAM = modal.Cls.from_name("grounded-sam", "GroundedSAM")
        result = GroundedSAM().segment.remote(image_bytes, class_list)
    except Exception as exc:
        logger.error(f"Modal segmentation failed: {traceback.format_exc()}")
        raise HTTPException(502, f"Modal segmentation failed: {exc}")

    masks = result.get("masks", [])
    class_ids = result.get("class_id", [])

    if not masks:
        return {"segments": [], "classes": class_list}

    # Decode original image
    buf = np.frombuffer(image_bytes, dtype=np.uint8)
    original = cv2.imdecode(buf, cv2.IMREAD_COLOR)

    # Build individual masked PNGs (BGRA with transparent background)
    segments = []
    for i, mask in enumerate(masks):
        mask_arr = np.array(mask, dtype=np.uint8)

        # Create BGRA image — transparent everywhere except the mask
        rgba = cv2.cvtColor(original, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = mask_arr * 255

        _, png_bytes = cv2.imencode(".png", rgba)
        b64 = base64.b64encode(png_bytes.tobytes()).decode()

        label = (
            class_list[class_ids[i]]
            if i < len(class_ids) and class_ids[i] < len(class_list)
            else "object"
        )
        segments.append({"image": b64, "label": label})

    return {"segments": segments, "classes": class_list}


# ── Static files (production) ────────────────────────────────────────
from fastapi.staticfiles import StaticFiles

dist_dir = Path(__file__).parent / "frontend" / "dist"
if dist_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
