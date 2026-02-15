"""Planning + Coding agent orchestration using the Claude Agent SDK."""

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

After reading the docs, respond with ONLY a valid JSON object (no markdown fences, \
no extra text):

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
You are a 3D modeling assistant that generates OpenSCAD code and a JSON scene graph \
for browser rendering.

Start by reading "plan.json" in your working directory using the Read tool. \
It contains the modeling plan you must follow.

Then create THREE files using the Write tool:

1. **model.scad** — Valid OpenSCAD code with parameterized variable declarations at \
the very top. Example:
```
// Parameters
width = 10;
height = 20;
hole_radius = 3;
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
  "width": { "value": 10, "type": "number", "description": "Width of the base cube" },
  "height": { "value": 20, "type": "number", "description": "Total height" }
}
```

3. **response.json** — Contains the scene graph and markdown explanation:
```json
{
  "sceneGraph": { ... },
  "markdown": "# Model Title\\n..."
}
```

## Scene Graph Format

The scene graph uses Y-up coordinates (Three.js convention).

### Primitive Nodes
- **cube**: { "type": "cube", "size": [w, h, d], "center": true }
- **sphere**: { "type": "sphere", "radius": number }
- **cylinder**: { "type": "cylinder", "radiusTop": n, "radiusBottom": n, "height": n }
- **cone**: { "type": "cone", "radius": n, "height": n }
- **torus**: { "type": "torus", "radius": n, "tube": n }
- **linear_extrude**: { "type": "linear_extrude", "height": n, "shape": [[x,y], ...] }
- **rotate_extrude**: { "type": "rotate_extrude", "points": [[x,y], ...], "segments": n }

### Boolean Nodes
- **union**: { "type": "union", "children": [node, ...] }
- **difference**: { "type": "difference", "children": [node, ...] }
- **intersection**: { "type": "intersection", "children": [node, ...] }

### Common Properties (all nodes)
- **color**: optional CSS color string
- **transforms**: optional { "translate": [x,y,z], "rotate": [x,y,z], "scale": [x,y,z] }

## Important Rules
1. Scene graph uses Y-up coordinates; OpenSCAD code uses Z-up.
2. Keep models reasonably sized (1-50 units).
3. The "markdown" should explain the model and how to customize parameters.
4. IMPORTANT: ensure structural integrity for 3D printing.
5. Write ALL three files. Do not skip any.
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

    # ── Phase 1: Planning ──────────────────────────────────────────────
    yield {"type": "plan_start"}

    plan_prompt = description
    if image_path:
        plan_prompt = f"[An image has been provided at {image_path}]\n\n{description}"

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

    coding_prompt = description
    if image_path:
        coding_prompt = f"[Reference image: {image_path}]\n\n{description}"

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
    plan_prompt = f"{context}\n\nThe user wants to refine the model: \"{feedback}\""

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
        f"Read plan.json for the updated plan, then rewrite model.scad, "
        f"parameters.json, and response.json accordingly."
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
# Helpers
# ---------------------------------------------------------------------------

def _assemble_result(session_dir: Path, coding_session_id: str | None) -> dict[str, Any]:
    """Read the output files and assemble the SSE result payload."""
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"
    response_path = session_dir / "response.json"

    scad_code = scad_path.read_text() if scad_path.exists() else "// No SCAD code generated"

    parameters: dict[str, Any] = {}
    if params_path.exists():
        try:
            parameters = json.loads(params_path.read_text())
        except json.JSONDecodeError:
            pass

    scene_graph: dict[str, Any] = {"type": "sphere", "radius": 2, "color": "#ff0000"}
    markdown = ""
    if response_path.exists():
        try:
            response = json.loads(response_path.read_text())
            scene_graph = response.get("sceneGraph", scene_graph)
            markdown = response.get("markdown", "")
        except json.JSONDecodeError:
            markdown = "# Error\n\nCould not parse response.json"

    return {
        "sessionId": session_dir.name,
        "result": {
            "scadCode": scad_code,
            "sceneGraph": scene_graph,
            "markdown": markdown,
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

    response_path = session_dir / "response.json"
    if response_path.exists():
        try:
            response = json.loads(response_path.read_text())
            md = response.get("markdown", "")
            title = md.split("\n")[0] if md else "Unknown model"
            parts.append(f"Current model: {title}")
        except (json.JSONDecodeError, AttributeError):
            pass

    return ". ".join(parts) if parts else "Existing model with prior context."
