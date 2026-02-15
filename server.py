import os
import uuid
import asyncio
import logging
import traceback
from pathlib import Path
from threading import Thread
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse
from PIL import Image
import fal_client
import httpx
import io
import json
import re
import subprocess
from pydantic import BaseModel

from glb_editor import run_glb_edit

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

# ── Config ───────────────────────────────────────────────────────────
os.environ.setdefault("FAL_KEY", os.environ.get("FAL_KEY", ""))

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_IMAGE_DIM = 4096  # Fal.AI max input dimension
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# ── Global state ─────────────────────────────────────────────────────
jobs: dict = {}


# ── Request models ───────────────────────────────────────────────────
class EditModelRequest(BaseModel):
    glb_filename: str
    instruction: str
    history: list[str] = []


# ── Fal.AI generation ────────────────────────────────────────────────
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


def run_fal(job_id: str, upload_paths: list[Path]):
    """Run Fal.AI TRELLIS-2 in a background thread."""
    job = jobs[job_id]
    try:
        job["status"] = "processing"
        job["progress"] = 5
        job["message"] = "Uploading images to Fal CDN..."

        # Upload each image to Fal CDN
        fal_urls = []
        for i, path in enumerate(upload_paths):
            url = fal_client.upload_file(str(path))
            fal_urls.append(url)
            job["progress"] = 5 + int(15 * (i + 1) / len(upload_paths))
            logger.info(f"Uploaded {path.name} → {url}")

        job["progress"] = 20
        job["message"] = "Running TRELLIS-2 on GPU..."

        # Choose endpoint based on image count
        if len(fal_urls) == 1:
            model_id = "fal-ai/trellis-2"
            arguments = {"image_url": fal_urls[0]}
        else:
            model_id = "fal-ai/trellis-2/multi"
            arguments = {"image_urls": fal_urls}

        logger.info(f"Submitting to {model_id} with {len(fal_urls)} image(s)")

        # Submit and poll
        handler = fal_client.submit(model_id, arguments=arguments)

        for event in handler.iter_events(with_logs=True):
            if isinstance(event, fal_client.InProgress):
                job["progress"] = min(job["progress"] + 3, 80)
                if hasattr(event, "logs") and event.logs:
                    last_log = event.logs[-1]
                    log_msg = last_log.get("message", "") if isinstance(last_log, dict) else str(last_log)
                    if log_msg:
                        job["message"] = log_msg
                        logger.info(f"Fal log: {log_msg}")

        result = handler.get()
        logger.info(f"Fal result keys: {list(result.keys()) if isinstance(result, dict) else type(result)}")

        job["progress"] = 85
        job["message"] = "Downloading model..."

        # Extract GLB URL from result
        glb_url = None
        if isinstance(result, dict):
            if "model_glb" in result and isinstance(result["model_glb"], dict):
                glb_url = result["model_glb"].get("url")
            elif "model_glb" in result and isinstance(result["model_glb"], str):
                glb_url = result["model_glb"]
            elif "glb" in result:
                glb_url = result["glb"] if isinstance(result["glb"], str) else result["glb"].get("url")

        if not glb_url:
            logger.error(f"Unexpected Fal output: {json.dumps(result, indent=2, default=str)}")
            raise RuntimeError(f"Could not find GLB URL in Fal output: {list(result.keys()) if isinstance(result, dict) else result}")

        logger.info(f"Downloading GLB from: {glb_url}")

        model_path = OUTPUT_DIR / f"{job_id}.glb"
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
    files: list[UploadFile] = File(...),
    resolution: int = Query(default=512, ge=256, le=2048),
):
    if len(files) > 10:
        raise HTTPException(400, "Maximum 10 images allowed")
    if len(files) == 0:
        raise HTTPException(400, "At least one image is required")

    job = new_job()
    upload_paths: list[Path] = []

    ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

    for i, file in enumerate(files):
        if file.content_type not in ALLOWED_TYPES:
            raise HTTPException(400, f"Unsupported file type: {file.content_type}")

        data = await file.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(
                400, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024} MB)"
            )

        try:
            img = Image.open(io.BytesIO(data))
        except Exception:
            raise HTTPException(400, f"Could not decode image #{i + 1}")

        # Resize if either dimension exceeds Fal.AI limit
        if img.width > MAX_IMAGE_DIM or img.height > MAX_IMAGE_DIM:
            img.thumbnail((MAX_IMAGE_DIM, MAX_IMAGE_DIM), Image.LANCZOS)
            logger.info(f"Resized image #{i + 1} to {img.width}x{img.height}")

        ext = ext_map.get(file.content_type, ".bin")
        upload_path = UPLOAD_DIR / f"{job['id']}_{i}{ext}"

        # Save the (possibly resized) image
        save_fmt = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
        fmt = save_fmt.get(file.content_type, "JPEG")
        if fmt == "JPEG" and img.mode == "RGBA":
            img = img.convert("RGB")
        img.save(upload_path, format=fmt, quality=90)

        upload_paths.append(upload_path)
        logger.info(f"Saved upload → {upload_path} ({upload_path.stat().st_size} bytes)")

    thread = Thread(
        target=run_fal,
        args=(job["id"], upload_paths),
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


# ── Edit model ───────────────────────────────────────────────────────
@app.post("/api/edit-model")
async def edit_model(req: EditModelRequest):
    """Edit a GLB model using the two-turn Claude pipeline."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(500, "ANTHROPIC_API_KEY not configured")

    glb_path = OUTPUT_DIR / req.glb_filename
    if not glb_path.exists() or not glb_path.name.endswith(".glb"):
        raise HTTPException(404, f"Model not found: {req.glb_filename}")

    try:
        input_path = str(glb_path.resolve())

        unique_id = uuid.uuid4().hex[:8]
        base_name = re.sub(r"_edited_[0-9a-f]+$", "", glb_path.stem)
        new_glb_filename = f"{base_name}_edited_{unique_id}.glb"
        output_path = str((OUTPUT_DIR / new_glb_filename).resolve())

        run_glb_edit(input_path, output_path, req.instruction, req.history, ANTHROPIC_API_KEY)

        logger.info(f"Agent edit produced: {new_glb_filename}")

        return {
            "success": True,
            "glb_filename": new_glb_filename,
            "scad_code": None,
            "message": f"Edit applied: {req.instruction}",
        }

    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Edit timed out")
    except RuntimeError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"Edit model failed: {traceback.format_exc()}")
        raise HTTPException(500, f"Edit failed: {str(e)}")


# ── Uploaded images ──────────────────────────────────────────────────
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


# ── Static files (production) ────────────────────────────────────────
from fastapi.staticfiles import StaticFiles

dist_dir = Path(__file__).parent / "frontend" / "dist"
if dist_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
