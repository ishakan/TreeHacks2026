#!/usr/bin/env python3
"""Minimalistic terminal client for the Blueprint-to-OpenSCAD workflow.

Usage:
    1. Start the server:  cd backend && uvicorn blueprint_server:app --port 8002

    Interactive mode:
        python test_blueprint.py

    Standalone tests:
        python test_blueprint.py blueprint "a coffee mug with a handle"
        python test_blueprint.py coding <session_id>
        python test_blueprint.py e2e "a coffee mug with a handle"

Dialogue sessions are saved to  backend/test_sessions/<session_id>/
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import httpx

BASE_URL = os.environ.get("BLUEPRINT_URL", "http://localhost:8002")
SAVE_DIR = Path(__file__).resolve().parent / "test_sessions"
SAVE_DIR.mkdir(exist_ok=True)

# Terminal colours
DIM = "\033[2m"
BOLD = "\033[1m"
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
RESET = "\033[0m"


# ---------------------------------------------------------------------------
# SSE streaming helper
# ---------------------------------------------------------------------------

def stream_sse(method: str, path: str, body: dict | None = None) -> dict | None:
    """Send a request and stream SSE events, printing text deltas live.

    Returns a dict with at least {"sessionId": ...} extracted during streaming,
    or None if an error occurred.  The actual artefacts (html, scad) are fetched
    separately via the REST session endpoint — NOT from SSE — because completion
    events can be too large for reliable inline JSON parsing.
    """
    url = f"{BASE_URL}{path}"
    session_id: str | None = None
    completed_type: str | None = None

    with httpx.Client(timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0)) as client:
        with client.stream(method, url, json=body) as resp:
            if resp.status_code != 200:
                print(f"{RED}HTTP {resp.status_code}: {resp.read().decode()}{RESET}")
                return None

            buf = ""
            for chunk in resp.iter_text():
                buf += chunk
                while "\n\n" in buf:
                    raw, buf = buf.split("\n\n", 1)
                    for line in raw.split("\n"):
                        if not line.startswith("data: "):
                            continue
                        try:
                            event = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue

                        etype = event.get("type", "")

                        # Capture session ID from any event that carries it
                        if "sessionId" in event:
                            session_id = event["sessionId"]

                        if etype == "blueprint_start":
                            print(f"\n{CYAN}--- Blueprint generation started ---{RESET}")
                        elif etype == "code_start":
                            print(f"\n{CYAN}--- Code generation started ---{RESET}")
                        elif etype == "text_delta":
                            sys.stdout.write(f"{DIM}{event.get('text', '')}{RESET}")
                            sys.stdout.flush()
                        elif etype == "blueprint_complete":
                            session_id = event.get("sessionId", session_id)
                            completed_type = "blueprint_complete"
                            print(f"\n{GREEN}--- Blueprint complete ---{RESET}")
                        elif etype == "code_complete":
                            session_id = event.get("sessionId", session_id)
                            completed_type = "code_complete"
                            print(f"\n{GREEN}--- Code complete ---{RESET}")
                        elif etype == "error":
                            print(f"\n{RED}Error: {event.get('error', '?')}{RESET}")

    if not session_id:
        return None

    return {"sessionId": session_id, "completedType": completed_type}


# ---------------------------------------------------------------------------
# Local save helpers
# ---------------------------------------------------------------------------

def fetch_and_save(session_id: str) -> tuple[Path, dict]:
    """Fetch the full session state via REST and save all artefacts locally.

    Returns (save_dir, session_data).
    """
    url = f"{BASE_URL}/api/blueprint/session/{session_id}"
    resp = httpx.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    d = SAVE_DIR / session_id
    d.mkdir(parents=True, exist_ok=True)

    saved: list[str] = []

    if "html" in data:
        (d / "blueprint.html").write_text(data["html"])
        saved.append("blueprint.html")
    if "dimensions" in data:
        (d / "blueprint_dimensions.json").write_text(
            json.dumps(data["dimensions"], indent=2)
        )
        saved.append("blueprint_dimensions.json")
    if "scadCode" in data:
        (d / "model.scad").write_text(data["scadCode"])
        saved.append("model.scad")
    if "parameters" in data:
        (d / "parameters.json").write_text(
            json.dumps(data["parameters"], indent=2)
        )
        saved.append("parameters.json")

    if saved:
        print(f"  {DIM}Saved: {', '.join(saved)}{RESET}")
    else:
        print(f"  {YELLOW}No artefact files returned by server{RESET}")

    return d, data


def save_dialogue(session_id: str, history: list[dict]) -> None:
    """Append the conversation history to a JSON log."""
    d = SAVE_DIR / session_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "dialogue.json").write_text(json.dumps(history, indent=2))


def print_dims(dims: dict) -> None:
    """Pretty-print blueprint dimensions."""
    if not dims:
        return
    print(f"\n{BOLD}Dimensions:{RESET}")
    for name, info in dims.items():
        v = info.get("value", "?")
        u = info.get("unit", "mm")
        desc = info.get("description", "")
        print(f"  {YELLOW}{name}{RESET} = {v} {u}  {DIM}({desc}){RESET}")


def print_params(params: dict) -> None:
    """Pretty-print OpenSCAD parameters."""
    if not params:
        return
    print(f"\n{BOLD}Parameters:{RESET}")
    for name, info in params.items():
        v = info.get("value", "?")
        desc = info.get("description", "")
        print(f"  {YELLOW}{name}{RESET} = {v}  {DIM}({desc}){RESET}")


# ---------------------------------------------------------------------------
# Standalone test: blueprint agent
# ---------------------------------------------------------------------------

def run_blueprint_test(description: str) -> str | None:
    """Run the blueprint agent end-to-end and return the session ID (or None on failure)."""
    print(f"\n{BOLD}=== Blueprint Agent Test ==={RESET}")
    print(f"  Description: {description}\n")

    result = stream_sse("POST", "/api/blueprint/generate", {"description": description})

    if not result or not result.get("sessionId"):
        print(f"{RED}No session returned.{RESET}")
        return None

    session_id = result["sessionId"]

    try:
        d, data = fetch_and_save(session_id)
    except Exception as exc:
        print(f"{RED}Failed to fetch/save session: {exc}{RESET}")
        return session_id

    print(f"\n{BOLD}Session:{RESET}  {session_id}")
    print(f"{BOLD}Saved to:{RESET} {d}")

    # Verify expected outputs
    html_ok = "html" in data and len(data["html"]) > 0
    dims_ok = "dimensions" in data and len(data["dimensions"]) > 0
    print(f"\n  blueprint.html          {'OK (' + str(len(data.get('html', ''))) + ' chars)' if html_ok else RED + 'MISSING' + RESET}")
    print(f"  blueprint_dimensions.json {'OK (' + str(len(data.get('dimensions', {}))) + ' params)' if dims_ok else RED + 'MISSING' + RESET}")

    if dims_ok:
        print_dims(data["dimensions"])

    return session_id


# ---------------------------------------------------------------------------
# Standalone test: coding agent
# ---------------------------------------------------------------------------

def run_coding_test(session_id: str) -> bool:
    """Run the coding agent on an existing session and return True on success.

    The coding agent reads three files:
      1. blueprint.html          — the confirmed HTML blueprint
      2. blueprint_dimensions.json — parametric dimensions from the blueprint
      3. openscad_docs.json       — OpenSCAD language reference (from backend/)

    It writes two files:
      1. model.scad      — the generated OpenSCAD code
      2. parameters.json  — structured parameter metadata
    """
    print(f"\n{BOLD}=== Coding Agent Test ==={RESET}")
    print(f"  Session: {session_id}\n")

    # --- verify input files exist on the server ---
    print(f"{CYAN}Checking input files...{RESET}")
    try:
        resp = httpx.get(f"{BASE_URL}/api/blueprint/session/{session_id}", timeout=10)
        resp.raise_for_status()
        pre = resp.json()
    except Exception as exc:
        print(f"{RED}Cannot reach session: {exc}{RESET}")
        return False

    html_ok = "html" in pre and len(pre["html"]) > 0
    dims_ok = "dimensions" in pre and len(pre["dimensions"]) > 0

    print(f"  blueprint.html            {'OK (' + str(len(pre.get('html', ''))) + ' chars)' if html_ok else RED + 'MISSING' + RESET}")
    print(f"  blueprint_dimensions.json {'OK (' + str(len(pre.get('dimensions', {}))) + ' params)' if dims_ok else RED + 'MISSING' + RESET}")
    print(f"  openscad_docs.json        {DIM}(loaded by server from backend/){RESET}")

    if not html_ok:
        print(f"\n{RED}Cannot run coding agent — no blueprint.html in session.{RESET}")
        return False

    # --- run the coding agent ---
    print(f"\n{CYAN}Running coding agent...{RESET}")
    result = stream_sse("POST", "/api/blueprint/confirm", {"sessionId": session_id})

    if not result:
        print(f"{RED}Coding agent returned no result.{RESET}")
        return False

    # --- fetch & save outputs ---
    try:
        d, data = fetch_and_save(session_id)
    except Exception as exc:
        print(f"{RED}Failed to fetch/save session: {exc}{RESET}")
        return False

    scad_ok = "scadCode" in data and len(data["scadCode"]) > 0
    params_ok = "parameters" in data and len(data["parameters"]) > 0

    print(f"\n{BOLD}Results:{RESET}")
    print(f"  model.scad      {'OK (' + str(len(data.get('scadCode', ''))) + ' chars)' if scad_ok else RED + 'MISSING' + RESET}")
    print(f"  parameters.json {'OK (' + str(len(data.get('parameters', {}))) + ' params)' if params_ok else RED + 'MISSING' + RESET}")
    print(f"{BOLD}Saved to:{RESET} {d}")

    if params_ok:
        print_params(data["parameters"])

    if scad_ok:
        preview = data["scadCode"][:300]
        print(f"\n{DIM}--- model.scad preview ---{RESET}")
        print(f"{DIM}{preview}{'...' if len(data['scadCode']) > 300 else ''}{RESET}")

    return scad_ok


# ---------------------------------------------------------------------------
# Standalone test: end-to-end (blueprint → coding)
# ---------------------------------------------------------------------------

def run_e2e_test(description: str) -> bool:
    """Run both agents back-to-back: blueprint then coding."""
    session_id = run_blueprint_test(description)
    if not session_id:
        return False

    print(f"\n{'─' * 60}\n")
    return run_coding_test(session_id)


# ---------------------------------------------------------------------------
# Interactive loop
# ---------------------------------------------------------------------------

def main() -> None:
    session_id: str | None = None
    phase = "idle"  # idle | blueprint | code
    dialogue: list[dict] = []

    cols = shutil.get_terminal_size().columns
    print(f"\n{'=' * cols}")
    print(f"{BOLD}  Blueprint-to-OpenSCAD Terminal Client{RESET}")
    print(f"  Server: {BASE_URL}")
    print(f"{'=' * cols}")
    print(f"\nCommands:")
    print(f"  {BOLD}describe <text>{RESET}  — Generate blueprint from description")
    print(f"  {BOLD}refine <text>{RESET}    — Refine the current blueprint")
    print(f"  {BOLD}confirm{RESET}          — Confirm blueprint & generate OpenSCAD")
    print(f"  {BOLD}refine-code <text>{RESET} — Refine the generated OpenSCAD code")
    print(f"  {BOLD}status{RESET}           — Show current session state")
    print(f"  {BOLD}open{RESET}             — Open blueprint.html in browser")
    print(f"  {BOLD}quit{RESET}             — Exit\n")

    while True:
        try:
            raw = input(f"{BOLD}> {RESET}").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not raw:
            continue

        cmd, _, arg = raw.partition(" ")
        cmd = cmd.lower()
        arg = arg.strip()

        # ---- describe ----
        if cmd == "describe":
            if not arg:
                print(f"{RED}Usage: describe <text>{RESET}")
                continue

            dialogue = [{"role": "user", "action": "describe", "text": arg}]
            result = stream_sse("POST", "/api/blueprint/generate", {"description": arg})

            if result and result.get("sessionId"):
                session_id = result["sessionId"]
                phase = "blueprint"
                try:
                    d, data = fetch_and_save(session_id)
                    dialogue.append({"role": "system", "event": "blueprint_complete", "sessionId": session_id})
                    save_dialogue(session_id, dialogue)
                    print(f"\n{BOLD}Session:{RESET} {session_id}")
                    print(f"{BOLD}Saved to:{RESET} {d}")
                    print_dims(data.get("dimensions", {}))
                except Exception as exc:
                    print(f"{RED}Failed to save session: {exc}{RESET}")
            else:
                print(f"{RED}No session returned.{RESET}")

        # ---- refine (blueprint) ----
        elif cmd == "refine":
            if not session_id:
                print(f"{RED}No active session. Use 'describe' first.{RESET}")
                continue
            if not arg:
                print(f"{RED}Usage: refine <feedback>{RESET}")
                continue

            dialogue.append({"role": "user", "action": "refine", "text": arg})
            result = stream_sse("POST", "/api/blueprint/refine", {
                "sessionId": session_id, "feedback": arg,
            })

            if result:
                try:
                    d, data = fetch_and_save(session_id)
                    dialogue.append({"role": "system", "event": "blueprint_complete"})
                    save_dialogue(session_id, dialogue)
                    print(f"\n{BOLD}Updated:{RESET} {d}")
                    print_dims(data.get("dimensions", {}))
                except Exception as exc:
                    print(f"{RED}Failed to save session: {exc}{RESET}")

        # ---- confirm ----
        elif cmd == "confirm":
            if not session_id:
                print(f"{RED}No active session. Use 'describe' first.{RESET}")
                continue

            dialogue.append({"role": "user", "action": "confirm"})
            result = stream_sse("POST", "/api/blueprint/confirm", {
                "sessionId": session_id,
            })

            if result:
                phase = "code"
                try:
                    d, data = fetch_and_save(session_id)
                    dialogue.append({"role": "system", "event": "code_complete"})
                    save_dialogue(session_id, dialogue)
                    print(f"\n{BOLD}Code saved to:{RESET} {d}")
                    print_params(data.get("parameters", {}))
                except Exception as exc:
                    print(f"{RED}Failed to save session: {exc}{RESET}")

        # ---- refine-code ----
        elif cmd in ("refine-code", "rc"):
            if not session_id:
                print(f"{RED}No active session.{RESET}")
                continue
            if not arg:
                print(f"{RED}Usage: refine-code <feedback>{RESET}")
                continue

            dialogue.append({"role": "user", "action": "refine-code", "text": arg})
            result = stream_sse("POST", "/api/blueprint/refine-code", {
                "sessionId": session_id, "feedback": arg,
            })

            if result:
                try:
                    d, data = fetch_and_save(session_id)
                    dialogue.append({"role": "system", "event": "code_complete"})
                    save_dialogue(session_id, dialogue)
                    print(f"\n{BOLD}Code updated:{RESET} {d}")
                    print_params(data.get("parameters", {}))
                except Exception as exc:
                    print(f"{RED}Failed to save session: {exc}{RESET}")

        # ---- status ----
        elif cmd == "status":
            if not session_id:
                print(f"{RED}No active session.{RESET}")
                continue

            url = f"{BASE_URL}/api/blueprint/session/{session_id}"
            try:
                resp = httpx.get(url, timeout=10)
                data = resp.json()
                print(f"\n{BOLD}Session:{RESET} {session_id}  |  Phase: {phase}")
                if "dimensions" in data:
                    print_dims(data["dimensions"])
                if "parameters" in data:
                    print_params(data["parameters"])
                has = []
                if "html" in data:
                    has.append("blueprint.html")
                if "scadCode" in data:
                    has.append("model.scad")
                if has:
                    print(f"  Files: {', '.join(has)}")
            except Exception as exc:
                print(f"{RED}Failed to fetch session: {exc}{RESET}")

        # ---- open ----
        elif cmd == "open":
            if not session_id:
                print(f"{RED}No active session.{RESET}")
                continue
            html_path = SAVE_DIR / session_id / "blueprint.html"
            if html_path.exists():
                import webbrowser
                webbrowser.open(html_path.as_uri())
                print(f"Opened {html_path}")
            else:
                print(f"{RED}No blueprint.html found.{RESET}")

        # ---- quit ----
        elif cmd in ("quit", "exit", "q"):
            break

        else:
            print(f"{RED}Unknown command: {cmd}{RESET}")
            print("Commands: describe, refine, confirm, refine-code, status, open, quit")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "blueprint":
        run_blueprint_test(" ".join(sys.argv[2:]))
    elif len(sys.argv) == 3 and sys.argv[1] == "coding":
        ok = run_coding_test(sys.argv[2])
        sys.exit(0 if ok else 1)
    elif len(sys.argv) >= 3 and sys.argv[1] == "e2e":
        ok = run_e2e_test(" ".join(sys.argv[2:]))
        sys.exit(0 if ok else 1)
    else:
        main()
