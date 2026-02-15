"""FastAPI application for ScadForge backend."""

from __future__ import annotations

import base64
import json
import os
import uuid
from pathlib import Path

# Allow the Claude Agent SDK to spawn nested Claude Code sessions.
# Without this, the SDK refuses to start when the server itself is
# launched from within a Claude Code terminal.
os.environ.pop("CLAUDECODE", None)

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Load .env from the project root (one level up from backend/).
# This is where the old TS server's .env lives.
_project_root = Path(__file__).resolve().parent.parent
load_dotenv(_project_root / ".env")

from agents import run_pipeline, run_refinement, update_parameters
from models import (
    GenerateRequest,
    ParameterEntry,
    ParameterResponse,
    ParameterUpdateRequest,
    RefineRequest,
)

app = FastAPI(title="ScadForge Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSIONS_DIR = Path(__file__).resolve().parent / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)


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
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/generate")
async def generate(req: GenerateRequest):
    session_id = str(uuid.uuid4())
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded image if present
    image_path: str | None = None
    if req.image:
        raw = req.image
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_bytes = base64.b64decode(raw)
        img_file = session_dir / "reference.png"
        img_file.write_bytes(img_bytes)
        image_path = str(img_file)

    pipeline = run_pipeline(req.description, image_path, session_dir)

    return StreamingResponse(
        _sse_generator(pipeline),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/refine")
async def refine(req: RefineRequest):
    session_dir = SESSIONS_DIR / req.sessionId
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {req.sessionId} not found")

    pipeline = run_refinement(req.sessionId, req.feedback, session_dir)

    return StreamingResponse(
        _sse_generator(pipeline),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/parameters/{session_id}")
async def get_parameters(session_id: str):
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    params_path = session_dir / "parameters.json"
    scad_path = session_dir / "model.scad"

    parameters: dict[str, ParameterEntry] = {}
    if params_path.exists():
        try:
            raw = json.loads(params_path.read_text())
            parameters = {k: ParameterEntry(**v) for k, v in raw.items()}
        except (json.JSONDecodeError, TypeError):
            pass

    scad_code = scad_path.read_text() if scad_path.exists() else ""

    return ParameterResponse(parameters=parameters, scadCode=scad_code)


@app.put("/api/parameters/{session_id}")
async def put_parameters(session_id: str, req: ParameterUpdateRequest):
    session_dir = SESSIONS_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    scad_code, parameters = update_parameters(session_dir, req.parameters)

    return ParameterResponse(parameters=parameters, scadCode=scad_code)
