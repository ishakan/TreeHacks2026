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
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
    ClaudeSDKError,
)

from agents import AgentError
from models import ParameterEntry

log = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Write-tool interception
# ---------------------------------------------------------------------------

def _intercept_write(block: ToolUseBlock, target_map: dict[str, Path]) -> None:
    """Capture content from a Write tool call and save it to the correct path.

    Claude Code's Write tool may resolve paths relative to its detected project
    root (the git root), which can differ from our intended session directory.
    By intercepting the ToolUseBlock *before* Claude Code executes it, we grab
    the content the agent intended and write it ourselves to the right place.

    ``target_map`` maps base filenames (e.g. "blueprint.html") to absolute
    target Paths.
    """
    if block.name != "Write":
        return
    try:
        inp = block.input if isinstance(block.input, dict) else {}
        content = inp.get("content", "")
        file_path = inp.get("file_path", "")
        if not content:
            return

        fname = Path(file_path).name if file_path else ""
        target = target_map.get(fname)
        if target:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
            log.info("Intercepted Write → %s (%d chars)", target.name, len(content))
        else:
            log.debug("Write tool call for untracked file: %s", file_path)
    except Exception as exc:
        log.warning("Failed to intercept Write tool call: %s", exc)


# ---------------------------------------------------------------------------
# SDK wrapper that surfaces tool-result errors
# ---------------------------------------------------------------------------

async def _blueprint_query(
    prompt: str,
    options: ClaudeAgentOptions,
) -> AsyncIterator[AssistantMessage | ResultMessage]:
    """Wrap query() with visibility into tool-result errors.

    Unlike the generic _safe_query in agents.py, this wrapper also inspects
    UserMessage/ToolResultBlock for Write-tool failures so callers can detect
    and react to them.
    """
    error_from_result: str | None = None
    write_errors: list[str] = []

    try:
        async for message in query(prompt=prompt, options=options):
            # Surface tool-result errors (Write failures, etc.)
            if isinstance(message, UserMessage):
                if hasattr(message, "content") and isinstance(message.content, list):
                    for block in message.content:
                        if isinstance(block, ToolResultBlock) and block.is_error:
                            err_text = ""
                            if isinstance(block.content, str):
                                err_text = block.content
                            elif isinstance(block.content, list):
                                err_text = str(block.content)
                            write_errors.append(err_text)
                            log.warning("Tool result error: %s", err_text)
                continue  # Don't yield UserMessages to consumer

            if isinstance(message, ResultMessage) and message.is_error:
                error_from_result = message.result or "Agent finished with an error"
                log.error("Agent error (from ResultMessage): %s", error_from_result)
                continue

            if isinstance(message, (AssistantMessage, ResultMessage)):
                yield message

    except (ClaudeSDKError, Exception) as exc:
        if error_from_result:
            log.debug("Suppressed post-iterator SDK exception: %s", exc)
        else:
            error_from_result = str(exc)
            log.error("SDK exception (no prior ResultMessage error): %s", exc)

    if write_errors:
        log.warning("Write tool errors during session: %s", write_errors)

    if error_from_result:
        raise AgentError(error_from_result)

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

BLUEPRINT_SYSTEM_PROMPT = """\
You are a technical blueprint designer that works EXCLUSIVELY through tools.

CRITICAL RULES — read these first:
- You MUST complete ALL work by calling Read and Write tools.
- Your text responses should ONLY be short status messages (e.g., "Reading description...", \
"Writing blueprint..."). NEVER put file content (HTML, JSON, code) in your text response.
- Use the EXACT absolute file paths given in the user prompt for all tool calls.

Guidelines for the files you will create:

FILE 1 — blueprint.html:
A self-contained HTML page (no external dependencies, viewable in a browser) containing:
- CSS custom properties on :root for all dimensions as unitless mm values \
(e.g., --width: 40; --height: 60;)
- Inline SVG showing 3-4 orthographic views (front, side, top, optionally isometric) \
arranged in standard engineering drawing layout
- Dimension lines with labels (thin lines with arrows, text showing "name: Nmm")
- Clean technical drawing aesthetic: white background, black lines, blue dimensions
- Hidden lines as dashed, center lines as dash-dot
- A title block with the object name and key specs

FILE 2 — blueprint_dimensions.json:
Parametric dimensions as a JSON object where each key maps to: \
{"value": <number>, "unit": "mm", "description": "<text>"}

Design rules:
1. Normalise the longest dimension to ~100mm. Scale others proportionally.
2. Include ALL key dimensions — widths, heights, radii, thicknesses, hole sizes, spacings.
3. Use descriptive parameter names (e.g., base_width, hole_radius, wall_thickness).
4. SVG dimension lines must show the parameter name and value.
5. SVG drawings should clearly communicate the 3D shape through multiple 2D views.

WORKFLOW (follow this exact sequence):
1. Read the description file using the Read tool.
2. Call the Write tool with the full HTML content for blueprint.html.
3. Call the Write tool with the full JSON content for blueprint_dimensions.json.
You MUST call Write for BOTH files. Do not skip any.
"""

CODING_FROM_BLUEPRINT_SYSTEM_PROMPT = """\
You are a 3D modeling assistant that works EXCLUSIVELY through tools. \
NEVER put file content (code, JSON) in your text response — always use the Write tool. \
Your text responses should ONLY be short status messages.

WORKFLOW:
1. Read the blueprint files and OpenSCAD docs using the Read tool (paths in user prompt).
2. Analyze the blueprint views to understand shape, topology, boolean ops, and symmetry.
3. Call the Write tool to create model.scad.
4. Call the Write tool to create parameters.json.

CAREFULLY analyze the blueprint views to understand:
- The overall shape and topology
- How the front, side, and top views correspond to 3D geometry
- Boolean operations needed (holes, cutouts, etc.)
- Symmetry that can be exploited with mirror()
- STRICTLY FOLLOW the geometries and orientations of each component (NO IMPROVISATION)

Use the EXACT absolute file paths given in the user prompt for all Write calls.

FILE 1 — model.scad:
Valid OpenSCAD code. Declare ALL dimensions as named variables at the top with \
range hints: // [min:step:max] Description. Variable names must match \
blueprint_dimensions.json keys. Use front view for XZ, side view for YZ, \
top view for XY. Ensure structural integrity for 3D printing. \
Output ONLY valid .scad code — no markdown, no explanation.

FILE 2 — parameters.json:
Structured metadata: {"name": {"value": N, "type": "number", "description": "..."}}

You MUST call Write for BOTH files. Do not skip any.
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
    yield {"type": "blueprint_start", "sessionId": session_dir.name}

    html_path = session_dir / "blueprint.html"
    dims_path = session_dir / "blueprint_dimensions.json"
    desc_path = session_dir / "description.txt"

    # Write description to a file so the agent can Read it (primes tool-use mode)
    desc_path.write_text(description)

    prompt = (
        f"Read the object description from: {desc_path}\n\n"
        f"Then create a technical blueprint for the described object.\n\n"
        f"Write the HTML blueprint to: {html_path}\n"
        f"Write the dimensions JSON to: {dims_path}"
    )

    options = ClaudeAgentOptions(
        model="claude-opus-4-6",
        system_prompt=BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=12,
    )

    # Map base filenames → correct target paths for Write interception
    write_targets = {
        "blueprint.html": html_path,
        "blueprint_dimensions.json": dims_path,
    }

    agent_text = ""
    char_count = 0
    tool_use_count = 0
    write_count = 0
    blueprint_session_id: str | None = None

    try:
        async for message in _blueprint_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        agent_text += block.text
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
                    elif isinstance(block, ToolUseBlock):
                        tool_use_count += 1
                        if block.name == "Write":
                            write_count += 1
                            _intercept_write(block, write_targets)
                        log.info("Blueprint agent tool call #%d: %s", tool_use_count, block.name)
            elif isinstance(message, ResultMessage):
                blueprint_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Blueprint agent failed: {exc}"}
        return

    log.info(
        "Blueprint agent finished: %d tool calls (%d writes), %d text chars, files exist: html=%s dims=%s",
        tool_use_count, write_count, char_count, html_path.exists(), dims_path.exists(),
    )

    # Save raw agent text for debugging
    (session_dir / "agent_output.txt").write_text(agent_text)

    # Fallback: if agent output HTML as text instead of using Write tool, extract and save
    if not html_path.exists() and agent_text:
        _extract_and_write_files(agent_text, html_path, dims_path)

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

    # Write feedback to a file so the agent reads it first (primes tool-use mode)
    feedback_path = session_dir / "feedback.txt"
    feedback_path.write_text(feedback)

    prompt = (
        f"Read the user's feedback from: {feedback_path}\n"
        f"Read the existing blueprint: {html_path}\n"
        f"Read the existing dimensions: {dims_path}\n\n"
        f"Then rewrite both files with the requested changes.\n"
        f"Write the updated HTML to: {html_path}\n"
        f"Write the updated dimensions to: {dims_path}"
    )

    options = ClaudeAgentOptions(
        model="claude-opus-4-6",
        system_prompt=BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=12,
    )
    if blueprint_session_id:
        options.resume = blueprint_session_id

    write_targets = {
        "blueprint.html": html_path,
        "blueprint_dimensions.json": dims_path,
    }

    agent_text = ""
    char_count = 0
    tool_use_count = 0
    write_count = 0
    new_session_id: str | None = None

    try:
        async for message in _blueprint_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        agent_text += block.text
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
                    elif isinstance(block, ToolUseBlock):
                        tool_use_count += 1
                        if block.name == "Write":
                            write_count += 1
                            _intercept_write(block, write_targets)
                        log.info("Blueprint refine tool call #%d: %s", tool_use_count, block.name)
            elif isinstance(message, ResultMessage):
                new_session_id = message.session_id
    except AgentError as exc:
        yield {"type": "error", "error": f"Blueprint refinement failed: {exc}"}
        return

    log.info(
        "Blueprint refine finished: %d tool calls (%d writes), %d text chars, html=%s dims=%s",
        tool_use_count, write_count, char_count, html_path.exists(), dims_path.exists(),
    )

    # Save raw agent text for debugging
    (session_dir / "agent_output.txt").write_text(agent_text)

    # Fallback: extract from text if Write tool wasn't used
    if not html_path.exists() and agent_text:
        _extract_and_write_files(agent_text, html_path, dims_path)

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
    yield {"type": "code_start", "sessionId": session_dir.name}

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
        model="claude-opus-4-6",
        system_prompt=CODING_FROM_BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=10,
    )

    write_targets = {
        "model.scad": scad_path,
        "parameters.json": params_path,
    }

    char_count = 0
    coding_session_id: str | None = None

    try:
        async for message in _blueprint_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
                    elif isinstance(block, ToolUseBlock):
                        if block.name == "Write":
                            _intercept_write(block, write_targets)
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
        model="claude-sonnet-4-5-20250929",
        system_prompt=CODING_FROM_BLUEPRINT_SYSTEM_PROMPT,
        allowed_tools=["Read", "Write"],
        permission_mode="bypassPermissions",
        cwd=str(session_dir),
        max_turns=10,
    )
    if coding_session_id:
        options.resume = coding_session_id

    write_targets = {
        "model.scad": scad_path,
        "parameters.json": params_path,
    }

    char_count = 0
    new_session_id: str | None = None

    try:
        async for message in _blueprint_query(prompt, options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        char_count += len(block.text)
                        yield {
                            "type": "text_delta",
                            "text": block.text,
                        }
                    elif isinstance(block, ToolUseBlock):
                        if block.name == "Write":
                            _intercept_write(block, write_targets)
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

def _extract_and_write_files(
    agent_text: str,
    html_path: Path,
    dims_path: Path,
) -> None:
    """Fallback: extract HTML and dimensions JSON from agent text output.

    The agent sometimes outputs file content as markdown-fenced text blocks
    instead of calling the Write tool. This function extracts and saves them.
    """
    log.warning("Write tool was not used — attempting to extract files from agent text output")

    # Extract HTML from ```html ... ``` fences or raw <!DOCTYPE ...
    html_match = re.search(
        r"```html\s*\n([\s\S]*?)```",
        agent_text,
    )
    if html_match:
        html_content = html_match.group(1).strip()
        html_path.write_text(html_content)
        log.info("Extracted HTML from markdown fence (%d chars)", len(html_content))
    else:
        # Try raw HTML block (<!DOCTYPE or <html)
        html_match = re.search(
            r"(<!DOCTYPE html>[\s\S]*?</html>)",
            agent_text,
            re.IGNORECASE,
        )
        if html_match:
            html_content = html_match.group(1).strip()
            html_path.write_text(html_content)
            log.info("Extracted raw HTML block (%d chars)", len(html_content))

    # Extract JSON from ```json ... ``` fences
    json_blocks = re.findall(r"```json\s*\n([\s\S]*?)```", agent_text)
    for block in json_blocks:
        try:
            parsed = json.loads(block.strip())
            # Detect dimensions JSON: values are dicts with "value" key
            if isinstance(parsed, dict) and any(
                isinstance(v, dict) and "value" in v for v in parsed.values()
            ):
                dims_path.write_text(json.dumps(parsed, indent=2))
                log.info("Extracted dimensions JSON (%d params)", len(parsed))
                break
        except json.JSONDecodeError:
            continue


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
