"""GLB mesh editing pipeline — spatial analysis, clustering, and LLM-driven vertex transforms."""

import os
import sys
import json
import struct
import re
import logging
import subprocess

import numpy as np
import anthropic

logger = logging.getLogger(__name__)


# ── Prompts ──────────────────────────────────────────────────────────

GLB_EDIT_SYSTEM_PROMPT = r"""# GLB Mesh Editing Agent

You modify GLB files by directly manipulating vertex data in Python using only `struct`, `json`, and `numpy`. No external 3D software.

## GLB Structure

A GLB is: 12-byte header → JSON chunk (scene graph, `type=0x4E4F534A`) → BIN chunk (raw vertex/index bytes, `type=0x004E4942`).

To find vertex positions: `mesh.primitives[].attributes.POSITION` → accessor index → accessor.bufferView → bufferView.byteOffset + accessor.byteOffset into the BIN chunk. Positions are VEC3 float32.

## Workflow

### 1. Parse
```python
import struct, json, numpy as np

with open("input.glb", "rb") as f:
    glb = bytearray(f.read())

chunk0_len = struct.unpack_from('<I', glb, 12)[0]
gltf = json.loads(glb[20:20+chunk0_len])
bin_start = 20 + chunk0_len + 8

# Find POSITION accessor from mesh primitive
pos_idx = gltf['meshes'][0]['primitives'][0]['attributes']['POSITION']
acc = gltf['accessors'][pos_idx]
bv = gltf['bufferViews'][acc['bufferView']]
offset = bin_start + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
count = acc['count']

pos = np.frombuffer(bytes(glb[offset:offset+count*12]), dtype=np.float32).reshape(-1, 3).copy()
```

### 2. Analyze — Use the pre-computed spatial analysis
The user message includes a detailed spatial analysis with **per-height-slice XZ clusters** and **structural columns** traced vertically. Study this data carefully — it tells you exactly which parts exist and where.

- **Structural Columns**: Each column has a center (X,Z), Y range, average radius, and a label (narrow=leg/post, wide=seat/crossbar). Use these to identify target parts.
- **Selection Hints**: Ready-to-use Python mask expressions are provided for each column. Copy and adapt these.

### 2b. Use Spatial Clusters for Vertex Selection (CRITICAL)

**NEVER select vertices by height alone.** A mask like `pos[:, 1] < threshold` catches crossbars, stretchers, and other structures at the same height. This is the #1 cause of bad edits.

**ALWAYS use compound masks** combining height range AND XZ proximity:

```python
# WRONG — catches crossbars at leg height
leg_mask = pos[:, 1] < seat_y

# RIGHT — cylindrical selection for one leg
cx, cz, r = -0.33, -0.32, 0.076  # from structural column data
leg0 = (pos[:, 1] < seat_y) & (np.sqrt((pos[:, 0] - cx)**2 + (pos[:, 2] - cz)**2) < r)

# RIGHT — select all 4 legs with OR
legs = leg0 | leg1 | leg2 | leg3
```

**Selection patterns by part type:**
- **Legs/posts (narrow columns):** Cylindrical mask centered on column center, radius = 2× reported avg_radius. Combine height range AND XZ proximity.
- **Seat/tabletop (wide):** Height range selection is OK since these span the full XZ extent.
- **Backrest (tall, narrow in one axis):** Combine height range AND one-axis range from column data.
- **Crossbar/stretcher:** Shows up as a [wide] cluster at leg height. To EXCLUDE it, use cylindrical leg selection.

### 3. Transform
Select vertices with a boolean mask and apply an anchor-relative transformation. Always transform relative to the boundary between the moving and fixed regions, so the fixed part stays in place.

**Before applying any transform, verify your mask:**
- Print the number of selected vertices and their bounding box.
- If the selection spans more than 50% of the XZ extent, you are likely catching unintended geometry. Narrow the mask using cluster centers and radii.

Common transforms:
- **Stretch**: `pos[mask, axis] = anchor + (pos[mask, axis] - anchor) * scale`
- **Translate**: `pos[mask, axis] += offset`
- **Scale region**: Scale two axes around the region's centroid
- **Taper**: Scale width proportionally to height

### 4. Write back and rebuild
```python
glb[offset:offset+count*12] = pos.astype(np.float32).tobytes()

acc['min'] = [float(pos[:,i].min()) for i in range(3)]
acc['max'] = [float(pos[:,i].max()) for i in range(3)]

new_json = json.dumps(gltf, separators=(',', ':')).encode()
new_json += b' ' * ((4 - len(new_json) % 4) % 4)
bin_chunk = bytes(glb[bin_start:bin_start + struct.unpack_from('<I', glb, 20+chunk0_len)[0]])

out = bytearray()
out += struct.pack('<III', 0x46546C67, 2, 0)
out += struct.pack('<II', len(new_json), 0x4E4F534A) + new_json
out += struct.pack('<II', len(bin_chunk), 0x004E4942) + bin_chunk
struct.pack_into('<I', out, 8, len(out))

with open("output.glb", "wb") as f:
    f.write(out)
```

### 5. Verify
Re-read the output, parse positions again, confirm the bounding box matches expectations and the file structure is valid.

## Rules
- **Always analyze before editing.** Phase 2 is not optional.
- **Only modify POSITION data.** Leave normals, UVs, textures, indices, and materials untouched.
- **Both byteOffsets stack**: `bin_start + bufferView.byteOffset + accessor.byteOffset`.
- **Don't hardcode accessor indices** — look them up from `primitives[].attributes.POSITION`.
- **Don't assume axis orientation** — verify from the data.
"""

# ── Spatial clustering ───────────────────────────────────────────────

def cluster_xz(points_xz: np.ndarray, eps: float, max_points: int = 2000) -> list[np.ndarray]:
    """Cluster 2D (X,Z) points using greedy connected components. Numpy-only."""
    n = len(points_xz)
    if n == 0:
        return []

    # Subsample if too many points
    if n > max_points:
        rng = np.random.default_rng(42)
        sample_idx = rng.choice(n, max_points, replace=False)
        sample_pts = points_xz[sample_idx]
    else:
        sample_idx = np.arange(n)
        sample_pts = points_xz

    m = len(sample_pts)
    labels_sample = -np.ones(m, dtype=int)
    cluster_id = 0

    for i in range(m):
        if labels_sample[i] != -1:
            continue
        stack = [i]
        labels_sample[i] = cluster_id
        while stack:
            current = stack.pop()
            dists = np.sqrt(
                (sample_pts[:, 0] - sample_pts[current, 0]) ** 2
                + (sample_pts[:, 1] - sample_pts[current, 1]) ** 2
            )
            neighbors = np.where((dists < eps) & (labels_sample == -1))[0]
            labels_sample[neighbors] = cluster_id
            stack.extend(neighbors.tolist())
        cluster_id += 1

    # Compute centroids from sample clusters
    centroids = []
    for cid in range(cluster_id):
        cmask = labels_sample == cid
        centroids.append(sample_pts[cmask].mean(axis=0))
    centroids = np.array(centroids)

    # Assign ALL points to nearest centroid
    if n > max_points:
        all_dists = np.sqrt(
            ((points_xz[:, np.newaxis, :] - centroids[np.newaxis, :, :]) ** 2).sum(axis=2)
        )
        all_labels = all_dists.argmin(axis=1)
    else:
        all_labels = labels_sample

    clusters = []
    for cid in range(cluster_id):
        indices = np.where(all_labels == cid)[0]
        if len(indices) > 0:
            clusters.append(indices)

    return clusters


def trace_columns(slice_data: list, bb_xz_diag: float) -> list[dict]:
    """Trace clusters vertically across height slices to identify structural columns.

    slice_data: list of (y_value, list_of_cluster_dicts)
        each cluster_dict: {'center_xz': (cx,cz), 'radius': r, 'count': n}
    Returns list of column dicts with center_xz, y_min, y_max, avg_radius, label.
    """
    columns: list[list] = []  # each: list of (y, cluster_dict)

    for y_val, clusters in sorted(slice_data, key=lambda x: x[0]):
        for cl in clusters:
            best_col = None
            best_dist = float("inf")
            for col in columns:
                last_y, last_cl = col[-1]
                dx = cl["center_xz"][0] - last_cl["center_xz"][0]
                dz = cl["center_xz"][1] - last_cl["center_xz"][1]
                dist = (dx**2 + dz**2) ** 0.5
                merge_threshold = max(cl["radius"], last_cl["radius"]) * 2.5
                if dist < merge_threshold and dist < best_dist:
                    best_dist = dist
                    best_col = col

            if best_col is not None:
                best_col.append((y_val, cl))
            else:
                columns.append([(y_val, cl)])

    results = []
    for col in columns:
        if len(col) < 2:
            continue
        ys = [e[0] for e in col]
        radii = [e[1]["radius"] for e in col]
        centers = [e[1]["center_xz"] for e in col]
        avg_cx = float(np.mean([c[0] for c in centers]))
        avg_cz = float(np.mean([c[1] for c in centers]))
        avg_r = float(np.mean(radii))

        label = "narrow" if avg_r < bb_xz_diag * 0.15 else "wide"
        results.append({
            "center_xz": (avg_cx, avg_cz),
            "y_min": min(ys),
            "y_max": max(ys),
            "avg_radius": avg_r,
            "slice_count": len(col),
            "label": label,
        })

    return results


def _desc_for_col(col: dict) -> str:
    """Short description for a structural column."""
    if col["label"] == "narrow":
        return "leg/post"
    return "wide structure"


# ── GLB analysis ─────────────────────────────────────────────────────

def analyze_glb(glb_path: str) -> str:
    """Parse a GLB and return a spatial analysis with per-slice XZ clustering."""
    with open(glb_path, "rb") as f:
        glb = bytearray(f.read())

    chunk0_len = struct.unpack_from("<I", glb, 12)[0]
    gltf = json.loads(glb[20 : 20 + chunk0_len])
    bin_start = 20 + chunk0_len + 8

    all_pos = []
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            pos_idx = prim.get("attributes", {}).get("POSITION")
            if pos_idx is None:
                continue
            acc = gltf["accessors"][pos_idx]
            bv = gltf["bufferViews"][acc["bufferView"]]
            off = bin_start + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            count = acc["count"]
            pos = np.frombuffer(
                bytes(glb[off : off + count * 12]), dtype=np.float32
            ).reshape(-1, 3)
            all_pos.append(pos)

    if not all_pos:
        return "No vertex position data found in GLB."

    pos = np.vstack(all_pos)
    bb_min = pos.min(axis=0)
    bb_max = pos.max(axis=0)
    bb_size = bb_max - bb_min
    bb_xz_diag = float(np.sqrt(bb_size[0] ** 2 + bb_size[2] ** 2))

    lines = [
        f"Vertex count: {len(pos)}",
        f"Bounding box min: [{bb_min[0]:.4f}, {bb_min[1]:.4f}, {bb_min[2]:.4f}]",
        f"Bounding box max: [{bb_max[0]:.4f}, {bb_max[1]:.4f}, {bb_max[2]:.4f}]",
        f"Size (XYZ): [{bb_size[0]:.4f}, {bb_size[1]:.4f}, {bb_size[2]:.4f}]",
        "",
    ]

    # Adaptive clustering epsilon
    eps = max(bb_size[0], bb_size[2]) * 0.08
    MAX_CLUSTERS_PER_SLICE = 10

    # Height slices along Y with XZ clustering
    lines.append("=== Height Slice Analysis (20 slices along Y) ===")
    slice_data = []  # for column tracing

    for i in range(20):
        t = bb_min[1] + bb_size[1] * (i + 0.5) / 20
        tol = bb_size[1] / 40
        mask = np.abs(pos[:, 1] - t) < tol
        n = int(mask.sum())
        if n == 0:
            continue

        sl = pos[mask]
        xz = sl[:, [0, 2]]

        # Cluster the XZ positions
        cur_eps = eps
        clusters_idx = cluster_xz(xz, cur_eps)
        # If too many clusters, widen eps and retry once
        if len(clusters_idx) > 50:
            cur_eps = eps * 2
            clusters_idx = cluster_xz(xz, cur_eps)

        # Build cluster info
        cluster_infos = []
        for cidx in clusters_idx:
            pts = xz[cidx]
            cx, cz = float(pts[:, 0].mean()), float(pts[:, 1].mean())
            dists = np.sqrt((pts[:, 0] - cx) ** 2 + (pts[:, 1] - cz) ** 2)
            r = float(np.percentile(dists, 95)) if len(dists) > 5 else float(dists.max()) if len(dists) > 0 else 0.0
            cluster_infos.append({
                "center_xz": (cx, cz),
                "radius": r,
                "count": len(cidx),
            })

        # Sort by count descending
        cluster_infos.sort(key=lambda c: c["count"], reverse=True)

        # Store for column tracing
        slice_data.append((float(t), cluster_infos))

        # Format output
        lines.append(f"Y={t:+.4f}: {n:5d} verts | {len(cluster_infos)} cluster(s)")
        reported = cluster_infos[:MAX_CLUSTERS_PER_SLICE]
        for ci, cl in enumerate(reported):
            label = "narrow" if cl["radius"] < bb_xz_diag * 0.15 else "wide"
            lines.append(
                f"  C{ci}: center=({cl['center_xz'][0]:+.4f},{cl['center_xz'][1]:+.4f}) "
                f"r={cl['radius']:.4f} verts={cl['count']} [{label}]"
            )
        if len(cluster_infos) > MAX_CLUSTERS_PER_SLICE:
            rest_count = sum(c["count"] for c in cluster_infos[MAX_CLUSTERS_PER_SLICE:])
            rest_n = len(cluster_infos) - MAX_CLUSTERS_PER_SLICE
            lines.append(f"  ...plus {rest_n} small clusters ({rest_count} verts)")

    # Trace structural columns
    columns = trace_columns(slice_data, bb_xz_diag)

    if columns:
        lines.append("")
        lines.append("=== Structural Columns (traced vertically) ===")
        for ci, col in enumerate(columns):
            cx, cz = col["center_xz"]
            desc = "likely a leg/post" if col["label"] == "narrow" else "likely a seat/crossbar/panel"
            lines.append(
                f"Column {ci}: center=({cx:+.4f},{cz:+.4f}) "
                f"Y=[{col['y_min']:+.4f}..{col['y_max']:+.4f}] "
                f"avg_r={col['avg_radius']:.4f} [{col['label']}] -- {desc}"
            )

        # Selection hints
        lines.append("")
        lines.append("=== Selection Hints (ready-to-use mask code) ===")
        for ci, col in enumerate(columns):
            if col["label"] == "narrow":
                cx, cz = col["center_xz"]
                sel_r = col["avg_radius"] * 2.0
                lines.append(
                    f"Column {ci} ({_desc_for_col(col)}): "
                    f"(pos[:,1] >= {col['y_min']:.4f}) & (pos[:,1] <= {col['y_max']:.4f}) & "
                    f"(np.sqrt((pos[:,0]-({cx:.4f}))**2 + (pos[:,2]-({cz:.4f}))**2) < {sel_r:.4f})"
                )
            else:
                lines.append(
                    f"Column {ci} ({_desc_for_col(col)}): "
                    f"(pos[:,1] >= {col['y_min']:.4f}) & (pos[:,1] <= {col['y_max']:.4f})"
                )

        # Check if mesh is a single blob (no distinct columns)
        all_wide = all(c["label"] == "wide" for c in columns)
        if all_wide:
            lines.append("")
            lines.append(
                "NOTE: This mesh has no distinct narrow structural columns — "
                "it appears to be a single continuous shape. "
                "Height-based selection may be appropriate."
            )

    return "\n".join(lines)


# ── Code extraction ──────────────────────────────────────────────────

def extract_python_code(text: str) -> str:
    """Extract Python code from a fenced code block."""
    pattern = r"```(?:python)?\s*\n(.*?)```"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


# ── Single-shot edit pipeline ────────────────────────────────────────

def run_glb_edit(
    input_path: str,
    output_path: str,
    instruction: str,
    history: list[str],
    api_key: str,
) -> None:
    """Single-shot Sonnet 4.5 call with pre-computed spatial analysis."""
    client = anthropic.Anthropic(api_key=api_key)

    # Pre-analyze the mesh with spatial clustering
    analysis = analyze_glb(input_path)
    logger.info(f"GLB analysis:\n{analysis[:1200]}")

    history_text = ""
    if history:
        history_text = "\nPrevious edits already applied (in order):\n"
        for i, h in enumerate(history, 1):
            history_text += f"  {i}. {h}\n"

    user_message = (
        f"## Mesh Analysis (pre-computed from the actual file)\n"
        f"{analysis}\n\n"
        f"## File Paths\n"
        f"- Input GLB: `{input_path}`\n"
        f"- Output GLB: `{output_path}`\n"
        f"{history_text}\n"
        f"## Edit Instruction\n"
        f"{instruction}\n\n"
        f"Think through the spatial reasoning carefully using the analysis above. "
        f"Map the user's instructions to the spatial analysis and select the appropriate vertices to edit."
        f"Then output a COMPLETE, self-contained Python script (using only "
        f"`struct`, `json`, `numpy`) that reads the input GLB, applies the "
        f"transformation, writes the output GLB, and verifies the result. "
        f"Output ONLY a fenced python code block."
    )

    logger.info("Calling Sonnet 4.5...")

    response = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=16000,
        system=[{
            "type": "text",
            "text": GLB_EDIT_SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_message}],
    )

    full_text = "\n".join(b.text for b in response.content if b.type == "text")
    script = extract_python_code(full_text)
    logger.info(f"Generated script ({len(script)} chars)")

    # Execute the script
    script_path = os.path.join(os.path.dirname(input_path), "edit_script.py")
    with open(script_path, "w") as f:
        f.write(script)

    result = subprocess.run(
        [sys.executable, script_path],
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.stdout:
        logger.info(f"Script stdout:\n{result.stdout[-2000:]}")
    if result.stderr:
        logger.warning(f"Script stderr:\n{result.stderr[-2000:]}")

    if result.returncode != 0:
        raise RuntimeError(
            f"Edit script failed (exit {result.returncode}):\n{result.stderr[-1000:]}"
        )

    if not os.path.exists(output_path):
        raise RuntimeError("Edit script ran but did not produce an output GLB file")
