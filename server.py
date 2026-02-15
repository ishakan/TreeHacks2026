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


# ── Job helpers ──────────────────────────────────────────────────────
def new_job() -> dict:
    job = {
        "id": str(uuid.uuid4()),
        "status": "queued",
        "progress": 0,
        "message": "Queued",
        "model_path": None,
        "error": None,
    }
    jobs[job["id"]] = job
    return job


def replicate_api(method, path, **kwargs):
    """Direct Replicate HTTP API call."""
    headers = {
        "Authorization": f"Bearer {REPLICATE_API_TOKEN}",
        "Content-Type": "application/json",
        "Prefer": "wait",
    }
    with httpx.Client(timeout=300) as client:
        resp = client.request(
            method,
            f"https://api.replicate.com/v1/{path}",
            headers=headers,
            **kwargs,
        )
        resp.raise_for_status()
        return resp.json()


def run_replicate(job_id: str, image_bytes: bytes, content_type: str):
    """Run Replicate TRELLIS in a background thread via HTTP API."""
    job = jobs[job_id]
    try:
        job["status"] = "processing"
        job["progress"] = 10
        job["message"] = "Uploading to Replicate..."

        # Encode image as data URI
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{content_type};base64,{b64}"

        job["progress"] = 20
        job["message"] = "Running TRELLIS on GPU..."

        # Get latest version of the model
        model_info = replicate_api("GET", f"models/{REPLICATE_MODEL}")
        latest_version = model_info["latest_version"]["id"]
        logger.info(f"Using model version: {latest_version}")

        # Create prediction — model expects "images" (array of URIs)
        prediction = replicate_api(
            "POST",
            "predictions",
            json={
                "version": latest_version,
                "input": {
                    "images": [data_uri],
                    "generate_color": True,
                    "generate_model": True,
                    "texture_size": 1024,
                    "mesh_simplify": 0.95,
                    "ss_sampling_steps": 12,
                    "slat_sampling_steps": 12,
                    "ss_guidance_strength": 7.5,
                    "slat_guidance_strength": 3.0,
                },
            },
        )

        pred_id = prediction["id"]
        logger.info(f"Prediction created: {pred_id}")

        # Poll for completion
        while prediction["status"] not in ("succeeded", "failed", "canceled"):
            time.sleep(2)
            prediction = replicate_api("GET", f"predictions/{pred_id}")
            status = prediction["status"]
            logger.info(f"Prediction {pred_id}: {status}")

            if status == "processing":
                job["progress"] = min(job["progress"] + 5, 80)
                job["message"] = "Generating 3D model on GPU..."

        if prediction["status"] != "succeeded":
            error = prediction.get("error", "Prediction failed")
            raise RuntimeError(f"Replicate prediction failed: {error}")

        job["progress"] = 85
        job["message"] = "Downloading model..."

        # Find GLB in output
        output = prediction["output"]
        glb_url = None

        if isinstance(output, dict):
            # Try common keys
            for key in ("model_file", "model", "mesh", "glb", "output"):
                if key in output and output[key]:
                    glb_url = output[key]
                    break
            if not glb_url:
                # Take first URL-like value
                for v in output.values():
                    if isinstance(v, str) and ("http" in v):
                        glb_url = v
                        break
        elif isinstance(output, list):
            for item in output:
                if isinstance(item, str) and (".glb" in item or "http" in item):
                    glb_url = item
                    break
            if not glb_url and output:
                glb_url = str(output[-1])
        elif isinstance(output, str):
            glb_url = output

        if not glb_url:
            logger.error(f"Unexpected output: {json.dumps(output, indent=2)}")
            raise RuntimeError(f"Could not find model file in output: {output}")

        logger.info(f"Downloading from: {glb_url}")

        # Download the model file
        ext = ".glb" if ".glb" in glb_url else (".obj" if ".obj" in glb_url else ".glb")
        model_path = OUTPUT_DIR / f"{job_id}{ext}"
        with httpx.Client(timeout=120) as client:
            resp = client.get(glb_url)
            resp.raise_for_status()
            model_path.write_bytes(resp.content)

        job["model_path"] = str(model_path)
        job["progress"] = 100
        job["message"] = "Complete"
        job["status"] = "completed"
        logger.info(
            f"Job {job_id} completed → {model_path} ({model_path.stat().st_size} bytes)"
        )

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["message"] = "Failed"
        logger.error(f"Job {job_id} failed: {traceback.format_exc()}")


# ── Routes ───────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.post("/api/upload")
async def upload(
    file: UploadFile = File(...),
    resolution: int = Query(default=512, ge=256, le=2048),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(
            400, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024} MB)"
        )

    try:
        Image.open(io.BytesIO(data))
    except Exception:
        raise HTTPException(400, "Could not decode image")

    job = new_job()

    # Persist the uploaded image to uploads/
    ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    ext = ext_map.get(file.content_type, ".bin")
    upload_path = UPLOAD_DIR / f"{job['id']}{ext}"
    upload_path.write_bytes(data)
    logger.info(f"Saved upload → {upload_path} ({len(data)} bytes)")

    thread = Thread(
        target=run_replicate,
        args=(job["id"], data, file.content_type),
        daemon=True,
    )
    thread.start()

    return {"job_id": job["id"]}


@app.get("/api/progress/{job_id}")
async def progress(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")

    async def event_generator():
        while True:
            job = jobs.get(job_id)
            if job is None:
                break

            yield {
                "event": "progress",
                "data": json.dumps(
                    {
                        "status": job["status"],
                        "progress": job["progress"],
                        "message": job["message"],
                        "error": job.get("error"),
                    }
                ),
            }

            if job["status"] in ("completed", "failed"):
                break

            await asyncio.sleep(0.5)

    return EventSourceResponse(event_generator())


@app.get("/api/download/{job_id}")
async def download(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "completed" or not job["model_path"]:
        raise HTTPException(400, "Model not ready")
    return FileResponse(
        job["model_path"],
        media_type="model/gltf-binary",
        filename=f"model-{job_id[:8]}.glb",
    )


# ── Past models ──────────────────────────────────────────────────────
@app.get("/api/models")
async def list_models():
    """List all GLB files in the outputs directory."""
    files = sorted(
        OUTPUT_DIR.glob("*.glb"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    return [
        {
            "filename": f.name,
            "size": f.stat().st_size,
            "created": f.stat().st_mtime,
        }
        for f in files
    ]


@app.get("/api/models/{filename}")
async def get_model(filename: str):
    """Serve a specific GLB from outputs."""
    path = OUTPUT_DIR / filename
    if not path.exists() or not path.name.endswith(".glb"):
        raise HTTPException(404, "Model not found")
    return FileResponse(path, media_type="model/gltf-binary", filename=filename)


# ── Uploaded images ───────────────────────────────────────────────────
@app.get("/api/uploads")
async def list_uploads():
    """List all saved upload images."""
    exts = {".jpg", ".jpeg", ".png", ".webp"}
    files = sorted(
        (f for f in UPLOAD_DIR.iterdir() if f.suffix.lower() in exts),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return [
        {
            "filename": f.name,
            "size": f.stat().st_size,
            "created": f.stat().st_mtime,
        }
        for f in files
    ]


@app.get("/api/uploads/{filename}")
async def get_upload(filename: str):
    """Serve a specific uploaded image."""
    path = UPLOAD_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Upload not found")
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    media_type = mime_map.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media_type, filename=filename)


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

    uvicorn.run(app, host="0.0.0.0", port=8000)
