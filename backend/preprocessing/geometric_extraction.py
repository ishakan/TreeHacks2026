"""Image preprocessing for OpenSCAD code generation.

Produces an annotated 4-panel composite image and structured geometry data
that helps the coding agent produce accurate OpenSCAD code.

Pipeline:
  1. Structural contour extraction (Canny + RETR_TREE hierarchy)
  2. Shape classification (polygon approximation)
  3. Hierarchy encoding (white=additive, red=subtractive)
  4. Symmetry axis detection (PCA)
  5. Bounding box annotations
  6. 4-panel composite assembly
  7. Structured geometry summary for agent prompt
"""

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Shape classification
# ---------------------------------------------------------------------------

def classify_shape(n_vertices: int) -> str:
    """Classify a polygon by its vertex count after approximation."""
    return {
        3: "triangle",
        4: "rectangle",
        5: "pentagon",
        6: "hexagon",
    }.get(n_vertices, "circle" if n_vertices > 8 else "polygon")


def approximate_to_polygons(contours: list) -> list[dict]:
    """Simplify raw contours to polygon approximations and classify each.

    Returns a list of dicts with contour, vertex count, shape name, area, bbox.
    """
    polygons = []
    for c in contours:
        # 2% of perimeter — good default for manufactured objects
        epsilon = 0.02 * cv2.arcLength(c, closed=True)
        approx = cv2.approxPolyDP(c, epsilon, closed=True)
        n_vertices = len(approx)
        polygons.append({
            "contour": approx,
            "vertices": n_vertices,
            "shape": classify_shape(n_vertices),
            "area": cv2.contourArea(c),
            "bbox": cv2.boundingRect(c),  # (x, y, w, h)
        })
    return polygons


# ---------------------------------------------------------------------------
# Structural contour extraction
# ---------------------------------------------------------------------------

def extract_structural_contours(
    image: np.ndarray,
    area_threshold: float = 0.001,
) -> tuple[list, np.ndarray, list[int]]:
    """Extract and filter contours from an image.

    Uses Canny edge detection and RETR_TREE to preserve the full contour
    hierarchy (essential for boolean-operation mapping).

    Returns:
        structural: filtered contour list
        hierarchy:  full hierarchy array from findContours
        indices:    original indices in the unfiltered contour list
                    (needed for correct hierarchy lookups)
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Bilateral filter to reduce noise while preserving edges
    filtered = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)

    # Canny for sharp geometric edges
    edges = cv2.Canny(filtered, threshold1=40, threshold2=120)

    # RETR_TREE preserves full hierarchy (parent/child nesting)
    contours, hierarchy = cv2.findContours(
        edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE,
    )

    if hierarchy is None:
        return [], np.zeros((1, 0, 4), dtype=np.int32), []

    # Filter noise — keep only contours above the area threshold
    img_area = image.shape[0] * image.shape[1]
    min_area = img_area * area_threshold

    structural = []
    indices = []
    for i, c in enumerate(contours):
        if cv2.contourArea(c) > min_area:
            structural.append(c)
            indices.append(i)

    return structural, hierarchy, indices


# ---------------------------------------------------------------------------
# Contour hierarchy encoding
# ---------------------------------------------------------------------------

def get_contour_depth(idx: int, hierarchy_row: np.ndarray) -> int:
    """Walk up the parent chain to find the nesting depth of a contour.

    hierarchy_row is hierarchy[0] from cv2.findContours with RETR_TREE.
    Each entry is [next, prev, first_child, parent].
    """
    depth = 0
    parent = hierarchy_row[idx][3]
    while parent != -1:
        depth += 1
        parent = hierarchy_row[parent][3]
    return depth


def encode_hierarchy_visually(
    canvas: np.ndarray,
    contours: list,
    hierarchy: np.ndarray,
    indices: list[int],
) -> np.ndarray:
    """Render contours colour-coded by CSG role.

    Even depth (0, 2, 4...) = additive  -> white  (union / main body)
    Odd  depth (1, 3, 5...) = subtractive -> red   (difference / holes)
    Thickness decreases with depth to show nesting visually.
    """
    result = canvas.copy()
    for orig_idx, c in zip(indices, contours):
        depth = get_contour_depth(orig_idx, hierarchy[0])
        if depth % 2 == 0:
            color = (200, 200, 200)   # additive — white
        else:
            color = (60, 60, 255)     # subtractive — red/blue (BGR)
        thickness = max(1, 3 - depth)
        cv2.drawContours(result, [c], -1, color, thickness)
    return result


# ---------------------------------------------------------------------------
# Symmetry & bounding-box annotations
# ---------------------------------------------------------------------------

def draw_symmetry_axes(image: np.ndarray, contours: list) -> np.ndarray:
    """Detect and draw symmetry axes using PCA of contour points."""
    if not contours:
        return image

    # Gather all contour points for PCA
    all_pts = np.vstack([c.reshape(-1, 2) for c in contours]).astype(np.float32)
    if len(all_pts) < 10:
        return image

    # PCA expects (N, 2) with rows as (y, x) — flip to match image coords
    pts_yx = np.flip(all_pts, axis=1)
    mean, eigenvectors = cv2.PCACompute(pts_yx, mean=None)
    cx, cy = int(mean[0][1]), int(mean[0][0])

    result = image.copy()
    axis_len = max(image.shape[:2]) // 3

    for i, color in enumerate([(0, 255, 255), (0, 150, 255)]):
        dx = int(eigenvectors[i][1] * axis_len)
        dy = int(eigenvectors[i][0] * axis_len)
        cv2.line(result, (cx - dx, cy - dy), (cx + dx, cy + dy), color, 2)

    cv2.circle(result, (cx, cy), 5, (255, 255, 0), -1)
    return result


def draw_bounding_annotations(
    image: np.ndarray,
    polygons: list[dict],
) -> np.ndarray:
    """Draw bounding boxes and shape labels on detected polygon regions."""
    result = image.copy()
    sorted_polys = sorted(polygons, key=lambda p: p["area"], reverse=True)

    for i, p in enumerate(sorted_polys):
        x, y, w, h = p["bbox"]
        color = (255, 100, 50) if i < 3 else (50, 200, 100)
        cv2.rectangle(result, (x, y), (x + w, y + h), color, 1)
        label = f"{p['shape']} {w}x{h}"
        cv2.putText(
            result, label, (x, y - 5),
            cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1,
        )
    return result


# ---------------------------------------------------------------------------
# 4-panel composite
# ---------------------------------------------------------------------------

def build_annotated_composite(
    original: np.ndarray,
    contours: list,
    hierarchy: np.ndarray,
    indices: list[int],
    polygons: list[dict],
) -> np.ndarray:
    """Build a 2x2 panel composite image for the agent to analyse.

    Images are assumed to have no background (already removed).

    Layout:
      Top-left:     Original image
      Top-right:    Contour hierarchy (white=additive, red=subtractive)
      Bottom-left:  Polygon approximations with shape labels
      Bottom-right: Symmetry axes + bounding boxes
    """
    h, w = original.shape[:2]
    composite = np.zeros((h * 2, w * 2, 3), dtype=np.uint8)

    # -- Panel 1: Original image ---------------------------------------------
    composite[0:h, 0:w] = original

    # -- Panel 2: Hierarchy-coloured contours --------------------------------
    contour_canvas = np.zeros((h, w, 3), dtype=np.uint8)
    contour_img = encode_hierarchy_visually(
        contour_canvas, contours, hierarchy, indices,
    )
    composite[0:h, w:w * 2] = contour_img

    # -- Panel 3: Polygon approximations with labels -------------------------
    poly_img = np.zeros((h, w, 3), dtype=np.uint8)
    for p in polygons:
        cv2.drawContours(poly_img, [p["contour"]], -1, (100, 200, 255), 2)
        M = cv2.moments(p["contour"])
        if M["m00"] > 0:
            cx = int(M["m10"] / M["m00"])
            cy = int(M["m01"] / M["m00"])
            cv2.putText(
                poly_img, p["shape"], (cx - 20, cy),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 100), 1,
            )
    composite[h:h * 2, 0:w] = poly_img

    # -- Panel 4: Symmetry + bounding-box annotations -----------------------
    annot_img = original.copy()
    annot_img = draw_symmetry_axes(annot_img, contours)
    annot_img = draw_bounding_annotations(annot_img, polygons)
    composite[h:h * 2, w:w * 2] = annot_img

    # -- Panel labels --------------------------------------------------------
    label_positions = [
        ("1: ORIGINAL",         (10,     20)),
        ("2: CONTOUR HIERARCHY", (w + 10, 20)),
        ("3: POLYGON APPROX",   (10,     h + 20)),
        ("4: ANNOTATED",        (w + 10, h + 20)),
    ]
    for text, pos in label_positions:
        cv2.putText(
            composite, text, pos,
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1,
        )

    return composite


# ---------------------------------------------------------------------------
# Geometry summary (structured data for the agent prompt)
# ---------------------------------------------------------------------------

def build_geometry_summary(
    polygons: list[dict],
    contour_count: int,
    img_dims: tuple[int, int],
) -> dict:
    """Build structured geometry data for the agent prompt.

    Returns a JSON-serialisable dict with contour count, image dimensions,
    and per-polygon shape/position/size information sorted by area.
    """
    shapes = []
    for p in sorted(polygons, key=lambda p: p["area"], reverse=True):
        shapes.append({
            "shape": p["shape"],
            "position": [int(p["bbox"][0]), int(p["bbox"][1])],
            "size": [int(p["bbox"][2]), int(p["bbox"][3])],
            "area": int(p["area"]),
            "vertices": p["vertices"],
        })

    return {
        "contour_count": contour_count,
        "image_dimensions": [int(img_dims[0]), int(img_dims[1])],
        "polygons": shapes,
    }


def format_geometry_for_prompt(summary: dict) -> str:
    """Format the geometry summary as human-readable text for the agent prompt."""
    lines = [
        f"Total structural contours detected: {summary['contour_count']}",
        f"Image dimensions: {summary['image_dimensions'][1]}x{summary['image_dimensions'][0]}px",
        "Polygon regions:",
    ]
    for p in summary["polygons"]:
        lines.append(
            f"  - {p['shape']} at position ({p['position'][0]}, {p['position'][1]}), "
            f"size {p['size'][0]}x{p['size'][1]}px, "
            f"area {p['area']}px\u00b2"
        )
    return "\n".join(lines)
