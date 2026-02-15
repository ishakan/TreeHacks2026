"""Image preprocessing pipeline for OpenSCAD generation.

Called by the agent orchestrator (agents.py) before the planning and coding
agents run.  Produces two files in the session directory:

  - composite.png  : 4-panel annotated image the agents can Read
  - geometry.json  : structured geometry data included in agent prompts
"""

import json
import sys
from pathlib import Path

# Ensure sibling modules (geometric_extraction) are importable regardless
# of how this file is imported (as preprocessing.main or directly).
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

import cv2 as cv
import numpy as np

import geometric_extraction as geo
import grounded_sam


def preprocess_image(image_path: str) -> dict:
    """Run the full preprocessing pipeline on a reference image.

    Args:
        image_path: Path to the uploaded reference image (absolute or relative).
        output_dir: Directory where composite.png and geometry.json are saved
                    (typically the session directory).

    Returns:
        dict with keys:
            composite_path  – absolute path to the composite PNG
            geometry_path   – absolute path to the geometry JSON
            geometry_text   – pre-formatted text for agent prompts
    """
    # Resolve to absolute so cv.imread and output paths are unambiguous
    image_path = _THIS_DIR / "images"

    # -- 1. Load image -------------------------------------------------------
    image = cv.imread(image_path)
    if image is None:
        raise ValueError(f"Could not load image: {image_path}")

    h, w = image.shape[:2]
    print(f"[preprocess] Loaded {image_path} ({w}x{h})")

    # -- 2. Extract structural contours + hierarchy --------------------------
    contours, hierarchy, indices = geo.extract_structural_contours(image)
    print(f"[preprocess] {len(contours)} structural contours extracted")

    # -- 3. Approximate to classified polygons -------------------------------
    polygons = geo.approximate_to_polygons(contours)

    # -- 4. Build the 4-panel composite image --------------------------------
    composite = geo.build_annotated_composite(
        image, contours, hierarchy, indices, polygons,
    )

    # -- 5. Build structured geometry summary --------------------------------
    summary = geo.build_geometry_summary(polygons, len(contours), (h, w))
    geometry_text = geo.format_geometry_for_prompt(summary)

    # -- 6. Save outputs -----------------------------------------------------
    composite_path = output_dir / "composite.png"
    geometry_path = output_dir / "geometry.json"

    cv.imwrite(str(composite_path), composite)
    geometry_path.write_text(json.dumps(summary, indent=2))

    print(f"[preprocess] Composite saved to {composite_path}")
    print(f"[preprocess] Geometry  saved to {geometry_path}")

    return {
        "composite_path": str(composite_path),
        "geometry_path": str(geometry_path),
        "geometry_text": geometry_text,
    }

if __name__ == "__main__":
    img_path = str("images/zen_garden.jpg")

    # Run grounded-SAM segmentation + annotation
    classes = ["rock"]
    image = cv.imread(img_path)
    detections, segments = grounded_sam.segment_image(image=image, classes=classes)
    annotated = grounded_sam.annotate_image(image=image, detections=detections, classes=classes)
    annotated_path = "images/zen_garden_annotated.jpg"
    cv.imwrite(annotated_path, annotated)
    print(f"annotated: {annotated_path}")