import os
import sys
import uuid
import asyncio
import logging
import tempfile
import traceback
from pathlib import Path
from threading import Thread
from dotenv import load_dotenv

load_dotenv()

# Prevent Claude Agent SDK from reusing a running Claude Code session
os.environ.pop("CLAUDECODE", None)

# Backend modules live in backend/ — add to sys.path so bare imports work
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from fastapi import FastAPI, Form, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse
from PIL import Image
import cv2 as cv
import httpx
import io
import json
import base64
import modal
import numpy as np
import time

from blueprint_agents import (
    run_blueprint,
    refine_blueprint,
    run_coding,
    refine_coding,
    update_blueprint_dimensions,
    update_scad_parameters,
)
from models import (
    BlueprintConfirmRequest,
    BlueprintDimensionUpdateRequest,
    BlueprintRefineRequest,
    BlueprintRequest,
    ParameterEntry,
    ParameterResponse,
    ParameterUpdateRequest,
)

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

# Session directories MUST be outside the git tree. Claude Code resolves Write
# tool paths relative to the git project root, so sessions inside the repo
# cause files to land in the wrong place.
SESSIONS_DIR = Path(tempfile.gettempdir()) / "blueprint-sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

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

    segment_b64s = result.get("segments", [])
    class_ids = result.get("class_id", [])
    annotated_image = result.get("annotated_image_b64", None)

    if not segment_b64s:
        return {"segments": [], "classes": class_list}

    # Pair pre-masked RGBA segments with labels
    segments = []
    for i, b64 in enumerate(segment_b64s):
        label = (
            class_list[class_ids[i]]
            if i < len(class_ids) and class_ids[i] < len(class_list)
            else "object"
        )
        segments.append({"image": b64, "label": label})

    return {"annotated_image": annotated_image, "segments": segments, "classes": class_list}


# ── Blueprint SSE helpers ─────────────────────────────────────────────

def _sse_encode(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _sse_generator(aiter):
    """Wrap an async iterator of dicts into SSE text chunks."""
    try:
        async for event in aiter:
            yield _sse_encode(event)
    except Exception as exc:
        yield _sse_encode({"type": "error", "error": str(exc)})


# ── Blueprint endpoints — Layer 1: Blueprint ──────────────────────────

@app.post("/api/blueprint/generate")
async def generate_blueprint(req: BlueprintRequest):
    """Start generating an HTML blueprint from a text description."""
    session_id = str(uuid.uuid4())
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    pipeline = run_blueprint(req.description, session_dir)

    return StreamingResponse(
        _sse_generator(pipeline),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/blueprint/refine")
async def refine_blueprint_endpoint(req: BlueprintRefineRequest):
    """Refine an existing blueprint design."""
    session_dir = SESSIONS_DIR / req.sessionId
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {req.sessionId} not found")

    pipeline = refine_blueprint(req.feedback, session_dir)

    return StreamingResponse(
        _sse_generator(pipeline),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ── Blueprint endpoints — Layer 2: Coding ─────────────────────────────

@app.post("/api/blueprint/confirm")
async def confirm_blueprint(req: BlueprintConfirmRequest):
    """Confirm a blueprint and start generating OpenSCAD code from it."""
    session_dir = SESSIONS_DIR / req.sessionId
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {req.sessionId} not found")

    # Verify blueprint exists
    if not (session_dir / "blueprint.html").exists():
        raise HTTPException(status_code=400, detail="No blueprint found — generate one first")

    pipeline = run_coding(session_dir)

    return StreamingResponse(
        _sse_generator(pipeline),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/blueprint/refine-code")
async def refine_code_endpoint(req: BlueprintRefineRequest):
    """Refine the generated OpenSCAD code."""
    session_dir = SESSIONS_DIR / req.sessionId
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {req.sessionId} not found")

    pipeline = refine_coding(req.feedback, session_dir)

    return StreamingResponse(
        _sse_generator(pipeline),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# ── Blueprint endpoints — Session state & parameter editing ───────────

@app.get("/api/blueprint/session/{session_id}")
async def get_session(session_id: str):
    """Get the current state of a blueprint session."""
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    result: dict = {
        "sessionId": session_id,
        "html": "",
        "dimensions": {},
        "scadCode": "",
        "parameters": {},
    }

    # Blueprint data
    html_path = session_dir / "blueprint.html"
    dims_path = session_dir / "blueprint_dimensions.json"
    if html_path.exists():
        result["html"] = html_path.read_text()
    if dims_path.exists():
        try:
            result["dimensions"] = json.loads(dims_path.read_text())
        except json.JSONDecodeError:
            pass

    # Code data
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"
    if scad_path.exists():
        result["scadCode"] = scad_path.read_text()
    if params_path.exists():
        try:
            result["parameters"] = json.loads(params_path.read_text())
        except json.JSONDecodeError:
            pass

    # Meta
    meta_path = session_dir / "meta.json"
    if meta_path.exists():
        try:
            result["meta"] = json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            pass

    return result


@app.put("/api/blueprint/dimensions/{session_id}")
async def put_dimensions(session_id: str, req: BlueprintDimensionUpdateRequest):
    """Update blueprint dimensions (JSON + CSS variables in HTML)."""
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    dims = update_blueprint_dimensions(session_dir, req.dimensions)

    html_path = session_dir / "blueprint.html"
    html = html_path.read_text() if html_path.exists() else ""

    return {"sessionId": session_id, "dimensions": dims, "html": html}


@app.put("/api/blueprint/parameters/{session_id}")
async def put_parameters(session_id: str, req: ParameterUpdateRequest):
    """Update OpenSCAD parameters (model.scad variables + parameters.json)."""
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    scad_code, parameters = update_scad_parameters(session_dir, req.parameters)

    return ParameterResponse(
        parameters={k: ParameterEntry(**v) for k, v in parameters.items()},
        scadCode=scad_code,
    )


# ── Static files (production) — MUST be last (catch-all mount) ────────
from fastapi.staticfiles import StaticFiles

dist_dir = Path(__file__).parent / "frontend" / "dist"
if dist_dir.is_dir():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
