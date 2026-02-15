"""[DEPRECATED] Planning + Coding agent orchestration using the Claude Agent SDK."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, AsyncIterator

import logging

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKError,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)

log = logging.getLogger(__name__)

from models import ParameterEntry, PlanResult

BACKEND_DIR = Path(__file__).resolve().parent

PLANNING_MAX_TOKENS = 1024
CODING_MAX_TOKENS = 4096

BASELINE_METHODS = [
    "cube", "sphere", "cylinder", "union", "difference",
    "translate", "rotate", "color", "$fn",
]

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

PLANNING_SYSTEM_PROMPT = """\
You are an OpenSCAD modeling planner. Given a user's description of a 3D model, \
analyze what OpenSCAD operations and techniques will be needed.

IMPORTANT: Start by reading the file "openscad_docs.json" in your working directory \
using the Read tool. This file contains a complete index of all available OpenSCAD \
operations with categories, syntax, parameters and examples.

If the user's request mentions a composite image or geometry data file, read those \
files using the Read tool BEFORE planning. The composite image is a 4-panel \
annotated image showing:
  - Panel 1 (top-left):  Original image of the object
  - Panel 2 (top-right): Contour hierarchy — WHITE = additive geometry (union), \
RED = subtractive geometry (difference)
  - Panel 3 (bottom-left): Polygon approximations with shape labels
  - Panel 4 (bottom-right): Symmetry axes (yellow) and bounding boxes

Use these visual cues to plan:
- White contours at even nesting depth → union() / main body primitives
- Red contours at odd nesting depth → difference() / holes / cuts
- Symmetry axes → consider mirror() operations
- Shape labels (rectangle, circle, etc.) → select matching OpenSCAD primitives

After reading the docs (and any provided image/geometry data), respond with ONLY \
a valid JSON object (no markdown fences, no extra text):

{
  "approach": "Brief description of the modeling approach",
  "steps": [
    { "description": "Step description", "operations": ["operation1", "operation2"] }
  ],
  "selectedMethods": ["cube", "difference", "translate", ...],
  "complexity": "simple | moderate | complex",
  "notes": "Any special considerations"
}

Rules:
1. "selectedMethods" must contain ONLY names that appear in the docs file.
2. Include ALL operations the coding layer will need — primitives, booleans, \
transforms, math functions, special variables, etc.
3. Typically select 10-25 methods. Include $fn if curves are involved.
4. "steps" should outline the construction sequence.
5. "complexity" is "simple" for basic shapes, "moderate" for multi-part assemblies, \
"complex" for intricate geometry.
"""

CODING_SYSTEM_PROMPT = """\
You are a 3D modeling assistant that generates OpenSCAD code.

Start by reading "plan.json" in your working directory using the Read tool. \
It contains the modeling plan you must follow.

If a composite image file exists in your working directory (composite.png), \
read it using the Read tool BEFORE writing code. It is a 4-panel annotated image:

PANEL GUIDE:
- Top-left (Panel 1): Original photo of the object (no background).
- Top-right (Panel 2): Contour hierarchy map.
  WHITE/LIGHT contours = additive geometry (union / main body).
  RED/BLUE contours = subtractive geometry (difference / holes / cuts).
  Nesting depth maps directly to OpenSCAD boolean operations.
- Bottom-left (Panel 3): Polygon-approximated contours. Text labels show shape \
classifications (rectangle, circle, hexagon, etc.).
- Bottom-right (Panel 4): Full annotation with symmetry axes (YELLOW lines) and \
bounding boxes (BLUE = major features, GREEN = minor).

BOOLEAN OPERATION MAPPING:
- White outer contour = main body primitive (cube, cylinder, etc.)
- Red inner contours = subtract these from the body (difference)
- White within red = add back into the subtracted region (union inside difference)
This nesting maps directly to OpenSCAD's difference() { } and union() { } syntax.

Create TWO files using the Write tool:

1. **model.scad** — Valid OpenSCAD code. Declare ALL dimensions as named variables \
at the very top with range hints in comments: // [min:step:max] Description
Example:
```
// Parameters
width = 10; // [5:1:50] Width of the base
height = 20; // [10:1:100] Total height
hole_radius = 3; // [1:0.5:10] Hole radius
$fn = 50;

// Model
difference() {
  cube([width, height, width], center=true);
  cylinder(h=height+2, r=hole_radius, center=true);
}
```

2. **parameters.json** — Structured metadata about each parameter:
```json
{
  "width": { "value": 10, "type": "number", "description": "Width of the base" },
  "height": { "value": 20, "type": "number", "description": "Total height" }
}
```

Important rules:
1. Normalise the longest visible dimension to 100mm. Estimate all other \
dimensions proportionally from the image or description.
2. Use Panel 3 (polygon approx) to identify the geometric primitives.
3. Use Panel 2 (hierarchy) to determine the boolean operations between them.
4. Use Panel 4 symmetry axes to apply mirror() where appropriate.
5. Ensure structural integrity for 3D printing.
6. Write BOTH files. Do not skip any.
7. Output ONLY valid .scad code in model.scad — no markdown, no explanation.
"""


# ---------------------------------------------------------------------------
# Safe SDK wrapper
# ---------------------------------------------------------------------------

async def _safe_query(
    prompt: str,
    options: ClaudeAgentOptions,
) -> AsyncIterator[AssistantMessage | ResultMessage]:
    """Wrap query() to surface real errors and suppress the redundant post-iterator exception.

    The SDK has two error paths:
      1. In-band: ResultMessage with is_error=True and the real error in .result
      2. Out-of-band: an Exception raised AFTER the iterator finishes, whose
         .stderr is just "Check stderr output for details" (useless).

    We must NEVER raise mid-iteration — doing so prevents the SDK from cleaning
    up its subprocess, which corrupts asyncio state for subsequent calls.
    Instead we let the iterator drain fully, then raise after it ends.
    """
    error_from_result: str | None = None
    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, ResultMessage) and message.is_error:
                error_from_result = message.result or "Agent finished with an error"
                log.error("Agent error (from ResultMessage): %s", error_from_result)
                # Do NOT raise here — let the iterator close cleanly.
                continue
            if isinstance(message, (AssistantMessage, ResultMessage)):
                yield message
    except (ClaudeSDKError, Exception) as exc:
        if error_from_result:
            # The post-iterator exception is a duplicate of what ResultMessage
            # already told us. Suppress it — we'll raise below with the real text.
            log.debug("Suppressed post-iterator SDK exception: %s", exc)
        else:
            # No ResultMessage gave us an error, so this is the only signal.
            error_from_result = str(exc)
            log.error("SDK exception (no prior ResultMessage error): %s", exc)

    if error_from_result:
        raise AgentError(error_from_result)


class AgentError(Exception):
    """Raised when an agent SDK call fails with a known error message."""


# ---------------------------------------------------------------------------
# Image preprocessing
# ---------------------------------------------------------------------------

def _run_preprocessing(image_path: str, session_dir: Path) -> dict | None:
    """Run the contour-annotation preprocessing pipeline on the reference image.

    Returns a dict with composite_path, geometry_path, geometry_text,
    or None if preprocessing fails (agents fall back to the raw image).
    """
    try:
        from preprocessing.main import preprocess_image
        result = preprocess_image(image_path, str(session_dir))
        print(f"[preprocess] Done — {len(result.get('geometry_text', '').split(chr(10)))} geometry lines")
        return result
    except Exception as exc:
        print(f"[preprocess] Image preprocessing failed: {exc} — agents will use raw image")
        return None


# ---------------------------------------------------------------------------
# Plan parsing
# ---------------------------------------------------------------------------

def parse_plan(text: str) -> PlanResult:
    """Extract a PlanResult from agent text output, with fallback."""
    json_str = text.strip()
    fence_match = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?\s*```", json_str)
    if fence_match:
        json_str = fence_match.group(1).strip()

    try:
        parsed = json.loads(json_str)
        plan = PlanResult(
            approach=parsed.get("approach", "Direct modeling"),
            steps=[
                {"description": s.get("description", ""), "operations": s.get("operations", [])}
                for s in parsed.get("steps", [])
            ],
            selectedMethods=parsed.get("selectedMethods", BASELINE_METHODS),
            complexity=parsed.get("complexity", "moderate"),
            notes=parsed.get("notes", ""),
        )
        if not plan.selectedMethods:
            plan.selectedMethods = list(BASELINE_METHODS)
        return plan
    except (json.JSONDecodeError, TypeError, KeyError):
        return PlanResult(
            approach="Direct modeling (plan parse failed)",
            steps=[],
            selectedMethods=list(BASELINE_METHODS),
            complexity="moderate",
            notes="Planning agent response could not be parsed. Using baseline methods.",
        )


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

async def run_pipeline(
    description: str,
    image_path: str | None,
    session_dir: Path,
) -> AsyncIterator[dict[str, Any]]:
    """Async generator that yields SSE-ready dicts for a full generate run."""

    # ── Image preprocessing (before agents) ────────────────────────────
    preproc: dict | None = None
    if image_path:
        preproc = _run_preprocessing(image_path, session_dir)

    # ── Phase 1: Planning ──────────────────────────────────────────────
    yield {"type": "plan_start"}

    plan_prompt = _build_plan_prompt(description, image_path, preproc, session_dir)

    planning_options = ClaudeAgentOptions(
        system_prompt=PLANNING_SYSTEM_PROMPT,
        allowed_tools=["Read", "Grep"],
        permission_mode="bypassPermissions",
        cwd=str(BACKEND_DIR),
        max_turns=5,
    )

    plan_text = ""
    plan_chars = 0
    planning_session_id: str | None = None

    try:
        async for message in _safe_query(plan_prompt, planning_options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        plan_text += block.text
                        plan_chars += len(block.text)
                        yield {
                            "type": "plan_delta",
                            "text": block.text,
                            "tokensReceived": min(plan_chars // 4, PLANNING_MAX_TOKENS - 1),
                            "maxTokens": PLANNING_MAX_TOKENS,
                        }
            elif isinstance(message, ResultMessage):
                planning_session_id = message.session_id
    except AgentError as exc:
        log.warning("Planning agent failed: %s — falling back to baseline", exc)
        plan_text = ""

    plan = parse_plan(plan_text) if plan_text else PlanResult(
        approach="Direct modeling (planning skipped)",
        steps=[],
        selectedMethods=list(BASELINE_METHODS),
        complexity="moderate",
        notes="Planning layer was skipped.",
    )

    # Write plan to session directory
    (session_dir / "plan.json").write_text(json.dumps(plan.model_dump(), indent=2))

    yield {
        "type": "plan_complete",
        "plan": plan.model_dump(),
    }

    # ── Phase 2: Coding ────────────────────────────────────────────────
    yield {"type": "code_start"}

    coding_prompt = _build_coding_prompt(description, image_path, preproc, session_dir)

    coding_options = ClaudeAgentOptions(
        system_prompt=CODING_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=10,
    )

    coding_text = ""
    coding_chars = 0
    coding_session_id: str | None = None

    try:
        async for message in _safe_query(coding_prompt, coding_options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        coding_text += block.text
                        coding_chars += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                            "tokensReceived": min(coding_chars // 4, CODING_MAX_TOKENS - 1),
                            "maxTokens": CODING_MAX_TOKENS,
                        }
            elif isinstance(message, ResultMessage):
                coding_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Coding agent failed: {exc}"}
        return

    # Read output files written by the agent
    result = _assemble_result(session_dir, coding_session_id)

    # Save session metadata for resumption
    meta = {
        "planning_session_id": planning_session_id,
        "coding_session_id": coding_session_id,
    }
    (session_dir / "meta.json").write_text(json.dumps(meta, indent=2))

    yield {"type": "result", **result}


async def run_refinement(
    session_id: str,
    feedback: str,
    session_dir: Path,
) -> AsyncIterator[dict[str, Any]]:
    """Async generator for refinement (same two-phase pattern)."""

    meta_path = session_dir / "meta.json"
    coding_session_id: str | None = None
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        coding_session_id = meta.get("coding_session_id")

    # Build context summary from existing files
    context = _build_context_summary(session_dir)

    # Check if preprocessed image data exists for this session
    composite_path = session_dir / "composite.png"
    geometry_path = session_dir / "geometry.json"
    has_visual = composite_path.exists()

    visual_hint = ""
    if has_visual:
        visual_hint = (
            f"\n\nVisual analysis files are available in the session directory:\n"
            f"- Annotated composite image: {composite_path}\n"
            f"- Geometry data: {geometry_path}\n"
            f"Read these with the Read tool if relevant to the refinement."
        )

    plan_prompt = (
        f"{context}\n\n"
        f"The user wants to refine the model: \"{feedback}\""
        f"{visual_hint}"
    )

    # ── Phase 1: Planning ──────────────────────────────────────────────
    yield {"type": "plan_start"}

    planning_options = ClaudeAgentOptions(
        system_prompt=PLANNING_SYSTEM_PROMPT,
        allowed_tools=["Read", "Grep"],
        permission_mode="bypassPermissions",
        cwd=str(BACKEND_DIR),
        max_turns=5,
    )

    plan_text = ""
    plan_chars = 0

    try:
        async for message in _safe_query(plan_prompt, planning_options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        plan_text += block.text
                        plan_chars += len(block.text)
                        yield {
                            "type": "plan_delta",
                            "text": block.text,
                            "tokensReceived": min(plan_chars // 4, PLANNING_MAX_TOKENS - 1),
                            "maxTokens": PLANNING_MAX_TOKENS,
                        }
    except AgentError as exc:
        log.warning("Planning agent failed during refinement: %s — falling back", exc)
        plan_text = ""

    plan = parse_plan(plan_text) if plan_text else PlanResult(
        approach="Direct refinement (planning skipped)",
        steps=[],
        selectedMethods=list(BASELINE_METHODS),
        complexity="moderate",
        notes="Planning layer was skipped.",
    )

    (session_dir / "plan.json").write_text(json.dumps(plan.model_dump(), indent=2))

    yield {
        "type": "plan_complete",
        "plan": plan.model_dump(),
    }

    # ── Phase 2: Coding (resume previous session if available) ─────────
    yield {"type": "code_start"}

    coding_options = ClaudeAgentOptions(
        system_prompt=CODING_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=10,
    )
    if coding_session_id:
        coding_options.resume = coding_session_id

    refinement_prompt = (
        f"The user wants the following changes: {feedback}\n"
        f"Read plan.json for the updated plan, then rewrite model.scad "
        f"and parameters.json accordingly."
    )

    coding_text = ""
    coding_chars = 0
    new_coding_session_id: str | None = None

    try:
        async for message in _safe_query(refinement_prompt, coding_options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        coding_text += block.text
                        coding_chars += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                            "tokensReceived": min(coding_chars // 4, CODING_MAX_TOKENS - 1),
                            "maxTokens": CODING_MAX_TOKENS,
                        }
            elif isinstance(message, ResultMessage):
                new_coding_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Coding agent failed: {exc}"}
        return

    result = _assemble_result(session_dir, new_coding_session_id)

    # Update metadata
    meta = {
        "planning_session_id": None,
        "coding_session_id": new_coding_session_id or coding_session_id,
    }
    (session_dir / "meta.json").write_text(json.dumps(meta, indent=2))

    yield {"type": "result", **result}


# ---------------------------------------------------------------------------
# Parameter editing
# ---------------------------------------------------------------------------

def update_parameters(
    session_dir: Path,
    new_values: dict[str, float | str],
) -> tuple[str, dict[str, ParameterEntry]]:
    """Regex-substitute variable declarations in model.scad and update parameters.json.

    Returns (updated_scad_code, updated_parameters).
    """
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"

    scad_code = scad_path.read_text() if scad_path.exists() else ""
    params: dict[str, ParameterEntry] = {}
    if params_path.exists():
        raw = json.loads(params_path.read_text())
        for k, v in raw.items():
            params[k] = ParameterEntry(**v)

    for name, new_val in new_values.items():
        # Regex: match  `name = <value>;`  allowing spaces
        if isinstance(new_val, (int, float)):
            replacement = f"{name} = {new_val};"
        else:
            replacement = f'{name} = "{new_val}";'

        pattern = rf"^({re.escape(name)}\s*=\s*).*?;\s*$"
        new_code, count = re.subn(pattern, replacement, scad_code, flags=re.MULTILINE)
        if count > 0:
            scad_code = new_code

        if name in params:
            params[name].value = new_val

    scad_path.write_text(scad_code)
    params_path.write_text(json.dumps({k: v.model_dump() for k, v in params.items()}, indent=2))

    return scad_code, params


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _build_plan_prompt(
    description: str,
    image_path: str | None,
    preproc: dict | None,
    session_dir: Path,
) -> str:
    """Build the prompt for the planning agent.

    If preprocessing succeeded, includes paths to the composite image and
    geometry data along with the pre-computed geometry text.
    If preprocessing failed but an image exists, falls back to the raw path.
    """
    parts = [description]

    if preproc:
        parts.append(
            f"\nVISUAL ANALYSIS (use Read tool to view these files):\n"
            f"- Annotated composite image: {preproc['composite_path']}\n"
            f"- Geometry data: {preproc['geometry_path']}\n"
            f"\nPRE-COMPUTED GEOMETRY (extracted programmatically — treat as high confidence):\n"
            f"{preproc['geometry_text']}"
        )
    elif image_path:
        parts.append(
            f"\nA reference image is available. Read it using the Read tool: {image_path}"
        )

    return "\n".join(parts)


def _build_coding_prompt(
    description: str,
    image_path: str | None,
    preproc: dict | None,
    session_dir: Path,
) -> str:
    """Build the prompt for the coding agent.

    Instructs the agent to read the composite image and geometry data,
    and includes pre-computed geometry facts inline.
    """
    parts = [description]

    if preproc:
        parts.append(
            f"\nIMPORTANT — VISUAL ANALYSIS FILES (read these with the Read tool "
            f"BEFORE writing any code):\n"
            f"- Annotated composite image: composite.png\n"
            f"- Geometry data: geometry.json\n"
            f"\nPRE-COMPUTED GEOMETRY (extracted programmatically — treat as high confidence):\n"
            f"{preproc['geometry_text']}\n"
            f"\nUse these annotations together with plan.json to produce accurate OpenSCAD code."
        )
    elif image_path:
        parts.append(
            f"\nA reference image is available. Read it using the Read tool: "
            f"reference.png"
        )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assemble_result(session_dir: Path, coding_session_id: str | None) -> dict[str, Any]:
    """Read the output files and assemble the SSE result payload."""
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"

    scad_code = scad_path.read_text() if scad_path.exists() else "// No SCAD code generated"

    parameters: dict[str, Any] = {}
    if params_path.exists():
        try:
            parameters = json.loads(params_path.read_text())
        except json.JSONDecodeError:
            pass

    return {
        "sessionId": session_dir.name,
        "result": {
            "scadCode": scad_code,
            "sceneGraph": {},
            "markdown": "",
            "parameters": parameters,
        },
    }


def _build_context_summary(session_dir: Path) -> str:
    """Build a brief context summary from existing session files."""
    parts: list[str] = []

    params_path = session_dir / "parameters.json"
    if params_path.exists():
        try:
            params = json.loads(params_path.read_text())
            param_str = ", ".join(f"{k}={v.get('value', '?')}" for k, v in params.items())
            parts.append(f"Current parameters: {param_str}")
        except (json.JSONDecodeError, AttributeError):
            pass

    scad_path = session_dir / "model.scad"
    if scad_path.exists():
        try:
            scad = scad_path.read_text()
            # Extract first comment line as a title hint
            for line in scad.split("\n"):
                line = line.strip()
                if line.startswith("//") and len(line) > 3:
                    parts.append(f"Current model: {line}")
                    break
        except Exception:
            pass

    return ". ".join(parts) if parts else "Existing model with prior context."
