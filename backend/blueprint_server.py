"""FastAPI application for the Blueprint-to-OpenSCAD workflow."""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path

os.environ.pop("CLAUDECODE", None)

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")

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

app = FastAPI(title="Blueprint-to-OpenSCAD Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Session directories MUST be outside the git tree. Claude Code resolves Write
# tool paths relative to the git project root, so sessions inside the repo
# cause files to land in the wrong place.
SESSIONS_DIR = Path(tempfile.gettempdir()) / "blueprint-sessions"
SESSIONS_DIR.mkdir(exist_ok=True)


@app.get("/")
async def root():
    return {"status": "ok", "service": "Blueprint-to-OpenSCAD", "docs": "/docs"}


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

def _sse_encode(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _sse_generator(aiter):
    """Wrap an async iterator of dicts into SSE text chunks."""
    try:
        async for event in aiter:
            yield _sse_encode(event)
    except Exception as exc:
        yield _sse_encode({"type": "error", "error": str(exc)})


# ---------------------------------------------------------------------------
# Endpoints — Layer 1: Blueprint
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Endpoints — Layer 2: Coding
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Endpoints — Session state & parameter editing
# ---------------------------------------------------------------------------

@app.get("/api/blueprint/session/{session_id}")
async def get_session(session_id: str):
    """Get the current state of a blueprint session."""
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    result: dict = {"sessionId": session_id}

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
