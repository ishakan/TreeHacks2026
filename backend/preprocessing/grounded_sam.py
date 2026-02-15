import cv2 as cv
import numpy as np
import supervision as sv
import modal


def segment_image(image, classes):
    # Read image and encode as PNG bytes for Modal transfer
    _, png_bytes = cv.imencode(".png", image)
    image_bytes = png_bytes.tobytes()

    # Call Modal remote GPU inference
    GroundedSAM = modal.Cls.from_name("grounded-sam", "GroundedSAM")
    result = GroundedSAM().segment.remote(image_bytes, classes)

    # Reconstruct sv.Detections from returned dict
    detections = sv.Detections(
        xyxy=np.array(result["xyxy"], dtype=np.float64),
        confidence=np.array(result["confidence"], dtype=np.float64),
        class_id=np.array(result["class_id"]),
    )

    masks = np.array(result["masks"], dtype=bool)
    if masks.size > 0:
        detections.mask = masks

    return detections


def annotate_image(image, detections, classes):
    labels = [
        f"{classes[cid]} {conf:.2f}"
        for cid, conf in zip(detections.class_id, detections.confidence)
    ]

    box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator()
    mask_annotator = sv.MaskAnnotator()

    annotated = mask_annotator.annotate(scene=image.copy(), detections=detections)
    annotated = box_annotator.annotate(scene=annotated, detections=detections)
    annotated = label_annotator.annotate(scene=annotated, detections=detections, labels=labels)

    return annotated
