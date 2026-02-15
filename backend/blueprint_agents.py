"""Blueprint-to-OpenSCAD agentic workflow.

Layer 1 (Blueprint Agent): text prompt → HTML blueprint with inline SVG views + dimensions JSON
Layer 2 (Coding Agent): confirmed blueprint → OpenSCAD code + parameters JSON

Both layers support iterative refinement via session resumption.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, AsyncIterator

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
)

from agents import _safe_query, AgentError
from models import ParameterEntry

log = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

BLUEPRINT_SYSTEM_PROMPT = """\
You are a technical blueprint designer. Given a text description of a 3D object, \
generate a self-contained HTML file with inline SVG showing orthographic views \
and a companion JSON file with parametric dimensions.

Create TWO files using the Write tool. Use the EXACT absolute file paths \
given in the user prompt.

1. **blueprint.html** — A self-contained HTML page with:
   - Inline SVG showing 3-4 orthographic views (front, side, top, and optionally isometric)
   - All critical dimensions declared as CSS custom properties on :root \
(e.g., --width: 40; --height: 60;) using unitless values (interpreted as mm)
   - Dimension lines with labels drawn in the SVG (thin lines with arrows and text)
   - A clean, technical drawing aesthetic (white background, black lines, blue dimensions)
   - SVG elements positioned using the CSS custom properties where practical
   - Views arranged in a standard engineering drawing layout
   - A title block with the object name and key specs
   - The HTML must be viewable by opening directly in a browser (no external dependencies)

   Structure the HTML like this:
   ```html
   <!DOCTYPE html>
   <html>
   <head>
     <style>
       :root {
         --width: 40;
         --height: 60;
         --depth: 30;
         /* ... more dimension variables ... */
       }
       /* Layout and styling */
     </style>
   </head>
   <body>
     <h2>Blueprint: Object Name</h2>
     <div class="views">
       <svg class="front-view" ...><!-- Front view with dimension lines --></svg>
       <svg class="side-view" ...><!-- Side view with dimension lines --></svg>
       <svg class="top-view" ...><!-- Top view with dimension lines --></svg>
     </div>
     <div class="title-block">
       <p>Dimensions in mm | Scale: not to scale</p>
     </div>
   </body>
   </html>
   ```

2. **blueprint_dimensions.json** — Parametric dimensions:
   ```json
   {
     "width": {"value": 40, "unit": "mm", "description": "Overall width of the base"},
     "height": {"value": 60, "unit": "mm", "description": "Total height"},
     "depth": {"value": 30, "unit": "mm", "description": "Depth / thickness"}
   }
   ```

Rules:
1. Normalise the longest dimension to approximately 100mm. Scale other dimensions proportionally.
2. Include ALL key dimensions — widths, heights, radii, thicknesses, hole sizes, spacings.
3. Use descriptive parameter names (e.g., base_width, hole_radius, wall_thickness).
4. Dimension lines in the SVG must show the parameter name and value (e.g., "width: 40mm").
5. Write BOTH files. Do not skip any.
6. The SVG drawings should clearly communicate the 3D shape through multiple 2D views.
7. Use standard engineering drawing conventions (hidden lines as dashed, center lines as dash-dot).
"""

CODING_FROM_BLUEPRINT_SYSTEM_PROMPT = """\
You are a 3D modeling assistant that converts HTML blueprints into OpenSCAD code.

Start by reading the following files in your working directory using the Read tool:
1. "blueprint.html" — the HTML blueprint with SVG orthographic views
2. "blueprint_dimensions.json" — the parametric dimensions
3. The OpenSCAD documentation file (path will be provided in the prompt)

Analyze the blueprint views to understand:
- The overall shape and topology
- How the front, side, and top views correspond to 3D geometry
- Boolean operations needed (holes, cutouts, etc.)
- Symmetry that can be exploited with mirror()

Create TWO files using the Write tool. Use the EXACT absolute file paths \
given in the user prompt.

1. **model.scad** — Valid OpenSCAD code. Declare ALL dimensions as named variables \
at the very top with range hints in comments: // [min:step:max] Description

The variable names should correspond to the dimension names from blueprint_dimensions.json.

Example:
```
// Parameters
width = 40; // [10:1:200] Overall width of the base
height = 60; // [10:1:200] Total height
depth = 30; // [10:1:200] Depth / thickness
hole_radius = 5; // [1:0.5:20] Hole radius
$fn = 50;

// Model
difference() {
  cube([width, depth, height], center=true);
  cylinder(h=height+2, r=hole_radius, center=true);
}
```

2. **parameters.json** — Structured metadata about each parameter:
```json
{
  "width": { "value": 40, "type": "number", "description": "Overall width of the base" },
  "height": { "value": 60, "type": "number", "description": "Total height" }
}
```

Rules:
1. Map blueprint dimensions to OpenSCAD variables (names must match).
2. Ensure the model accurately represents the geometry shown in the blueprint views.
3. Use the blueprint's front view for the XZ plane, side view for the YZ plane, top view for the XY plane.
4. Ensure structural integrity for 3D printing (no zero-thickness walls, manifold geometry).
5. Write BOTH files. Do not skip any.
6. Output ONLY valid .scad code in model.scad — no markdown, no explanation.
"""


# ---------------------------------------------------------------------------
# Layer 1: Blueprint generation
# ---------------------------------------------------------------------------

async def run_blueprint(
    description: str,
    session_dir: Path,
) -> AsyncIterator[dict[str, Any]]:
    """Generate an HTML blueprint from a text description.

    Yields SSE-ready dicts: blueprint_start, text_delta, blueprint_complete.
    """
    yield {"type": "blueprint_start"}

    html_path = session_dir / "blueprint.html"
    dims_path = session_dir / "blueprint_dimensions.json"

    prompt = (
        f"Create a technical blueprint for the following object:\n\n{description}\n\n"
        f"Write the HTML blueprint to: {html_path}\n"
        f"Write the dimensions JSON to: {dims_path}"
    )

    options = ClaudeAgentOptions(
        system_prompt=BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=8,
    )

    agent_text = ""
    char_count = 0
    blueprint_session_id: str | None = None

    try:
        async for message in _safe_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        agent_text += block.text
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
            elif isinstance(message, ResultMessage):
                blueprint_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Blueprint agent failed: {exc}"}
        return

    # Read generated files
    result = _assemble_blueprint_result(session_dir, blueprint_session_id)

    # Save / update meta
    _update_meta(session_dir, blueprint_session_id=blueprint_session_id)

    yield {"type": "blueprint_complete", **result}


async def refine_blueprint(
    feedback: str,
    session_dir: Path,
) -> AsyncIterator[dict[str, Any]]:
    """Refine an existing blueprint based on user feedback.

    Resumes the previous blueprint agent session.
    """
    yield {"type": "blueprint_start"}

    meta = _read_meta(session_dir)
    blueprint_session_id = meta.get("blueprint_session_id")

    html_path = session_dir / "blueprint.html"
    dims_path = session_dir / "blueprint_dimensions.json"

    prompt = (
        f"The user wants the following changes to the blueprint:\n\n{feedback}\n\n"
        f"Read the existing blueprint: {html_path}\n"
        f"Read the existing dimensions: {dims_path}\n"
        f"Then rewrite both files with the requested changes."
    )

    options = ClaudeAgentOptions(
        system_prompt=BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=8,
    )
    if blueprint_session_id:
        options.resume = blueprint_session_id

    char_count = 0
    new_session_id: str | None = None

    try:
        async for message in _safe_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
            elif isinstance(message, ResultMessage):
                new_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Blueprint refinement failed: {exc}"}
        return

    _update_meta(
        session_dir,
        blueprint_session_id=new_session_id or blueprint_session_id,
    )

    result = _assemble_blueprint_result(session_dir, new_session_id or blueprint_session_id)
    yield {"type": "blueprint_complete", **result}


# ---------------------------------------------------------------------------
# Layer 2: Coding from blueprint
# ---------------------------------------------------------------------------

async def run_coding(
    session_dir: Path,
) -> AsyncIterator[dict[str, Any]]:
    """Convert a confirmed blueprint into OpenSCAD code.

    Yields SSE-ready dicts: code_start, text_delta, code_complete.
    """
    yield {"type": "code_start"}

    docs_path = BACKEND_DIR / "openscad_docs.json"
    html_path = session_dir / "blueprint.html"
    dims_path = session_dir / "blueprint_dimensions.json"
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"

    prompt = (
        f"Read the blueprint files and generate OpenSCAD code.\n\n"
        f"Files to read:\n"
        f"- Blueprint HTML: {html_path}\n"
        f"- Dimensions JSON: {dims_path}\n"
        f"- OpenSCAD documentation: {docs_path}\n\n"
        f"Write the OpenSCAD code to: {scad_path}\n"
        f"Write the parameters JSON to: {params_path}"
    )

    options = ClaudeAgentOptions(
        system_prompt=CODING_FROM_BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=10,
    )

    char_count = 0
    coding_session_id: str | None = None

    try:
        async for message in _safe_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
            elif isinstance(message, ResultMessage):
                coding_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Coding agent failed: {exc}"}
        return

    _update_meta(session_dir, coding_session_id=coding_session_id)

    result = _assemble_code_result(session_dir, coding_session_id)
    yield {"type": "code_complete", **result}


async def refine_coding(
    feedback: str,
    session_dir: Path,
) -> AsyncIterator[dict[str, Any]]:
    """Refine the generated OpenSCAD code based on user feedback.

    Resumes the previous coding agent session.
    """
    yield {"type": "code_start"}

    meta = _read_meta(session_dir)
    coding_session_id = meta.get("coding_session_id")

    docs_path = BACKEND_DIR / "openscad_docs.json"
    html_path = session_dir / "blueprint.html"
    dims_path = session_dir / "blueprint_dimensions.json"
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"

    prompt = (
        f"The user wants the following changes to the OpenSCAD code:\n\n{feedback}\n\n"
        f"Read the existing files:\n"
        f"- OpenSCAD code: {scad_path}\n"
        f"- Parameters: {params_path}\n"
        f"- Blueprint: {html_path}\n"
        f"- Dimensions: {dims_path}\n"
        f"- OpenSCAD docs: {docs_path}\n\n"
        f"Then rewrite {scad_path} and {params_path} with the requested changes."
    )

    options = ClaudeAgentOptions(
        system_prompt=CODING_FROM_BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=10,
    )
    if coding_session_id:
        options.resume = coding_session_id

    char_count = 0
    new_session_id: str | None = None

    try:
        async for message in _safe_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
            elif isinstance(message, ResultMessage):
                new_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Coding refinement failed: {exc}"}
        return

    _update_meta(
        session_dir,
        coding_session_id=new_session_id or coding_session_id,
    )

    result = _assemble_code_result(session_dir, new_session_id or coding_session_id)
    yield {"type": "code_complete", **result}


# ---------------------------------------------------------------------------
# Dimension / parameter update helpers
# ---------------------------------------------------------------------------

def update_blueprint_dimensions(
    session_dir: Path,
    new_values: dict[str, float | int],
) -> dict:
    """Update dimension values in blueprint_dimensions.json and CSS variables in blueprint.html.

    Returns the updated dimensions dict.
    """
    dims_path = session_dir / "blueprint_dimensions.json"
    html_path = session_dir / "blueprint.html"

    # Update JSON
    dims: dict = {}
    if dims_path.exists():
        try:
            dims = json.loads(dims_path.read_text())
        except json.JSONDecodeError:
            pass

    for name, new_val in new_values.items():
        if name in dims:
            dims[name]["value"] = new_val
        else:
            dims[name] = {"value": new_val, "unit": "mm", "description": name}

    dims_path.write_text(json.dumps(dims, indent=2))

    # Update CSS custom properties in the HTML
    if html_path.exists():
        html = html_path.read_text()
        for name, new_val in new_values.items():
            # Match: --name: <old_value>;  (with optional spaces)
            pattern = rf"(--{re.escape(name)}\s*:\s*)[\d.]+(\s*;)"
            html = re.sub(pattern, rf"\g<1>{new_val}\2", html)
        html_path.write_text(html)

    return dims


def update_scad_parameters(
    session_dir: Path,
    new_values: dict[str, float | str],
) -> tuple[str, dict]:
    """Update parameter values in model.scad and parameters.json.

    Returns (updated_scad_code, updated_parameters_dict).
    """
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"

    scad_code = scad_path.read_text() if scad_path.exists() else ""
    params: dict[str, ParameterEntry] = {}
    if params_path.exists():
        try:
            raw = json.loads(params_path.read_text())
            for k, v in raw.items():
                params[k] = ParameterEntry(**v)
        except (json.JSONDecodeError, TypeError):
            pass

    for name, new_val in new_values.items():
        # Match the variable value while preserving the trailing comment
        # e.g. "width = 40; // [10:1:200] Width" → "width = 80; // [10:1:200] Width"
        if isinstance(new_val, (int, float)):
            val_str = str(new_val)
        else:
            val_str = f'"{new_val}"'

        pattern = rf"^({re.escape(name)}\s*=\s*)[\d.eE+\-\"]+(\s*;.*)$"
        replacement = rf"\g<1>{val_str}\2"
        new_code, count = re.subn(pattern, replacement, scad_code, flags=re.MULTILINE)
        if count > 0:
            scad_code = new_code

        if name in params:
            params[name].value = new_val

    scad_path.write_text(scad_code)
    params_dict = {k: v.model_dump() for k, v in params.items()}
    params_path.write_text(json.dumps(params_dict, indent=2))

    return scad_code, params_dict


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _read_meta(session_dir: Path) -> dict:
    """Read session meta.json, returning empty dict if missing."""
    meta_path = session_dir / "meta.json"
    if meta_path.exists():
        try:
            return json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            pass
    return {}


def _update_meta(
    session_dir: Path,
    *,
    blueprint_session_id: str | None = None,
    coding_session_id: str | None = None,
) -> None:
    """Merge new session IDs into meta.json (preserves existing keys)."""
    meta = _read_meta(session_dir)
    if blueprint_session_id is not None:
        meta["blueprint_session_id"] = blueprint_session_id
    if coding_session_id is not None:
        meta["coding_session_id"] = coding_session_id
    (session_dir / "meta.json").write_text(json.dumps(meta, indent=2))


def _assemble_blueprint_result(
    session_dir: Path,
    session_id: str | None,
) -> dict[str, Any]:
    """Read blueprint output files and assemble the SSE result payload."""
    html_path = session_dir / "blueprint.html"
    dims_path = session_dir / "blueprint_dimensions.json"

    html = html_path.read_text() if html_path.exists() else ""
    dimensions: dict = {}
    if dims_path.exists():
        try:
            dimensions = json.loads(dims_path.read_text())
        except json.JSONDecodeError:
            pass

    return {
        "sessionId": session_dir.name,
        "html": html,
        "dimensions": dimensions,
    }


def _assemble_code_result(
    session_dir: Path,
    session_id: str | None,
) -> dict[str, Any]:
    """Read coding output files and assemble the SSE result payload."""
    scad_path = session_dir / "model.scad"
    params_path = session_dir / "parameters.json"

    scad_code = scad_path.read_text() if scad_path.exists() else "// No SCAD code generated"
    parameters: dict = {}
    if params_path.exists():
        try:
            parameters = json.loads(params_path.read_text())
        except json.JSONDecodeError:
            pass

    return {
        "sessionId": session_dir.name,
        "scadCode": scad_code,
        "parameters": parameters,
    }
