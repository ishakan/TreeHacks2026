from pathlib import Path
import base64

import modal

LOCAL_DIR = Path(__file__).parent

app = modal.App("grounded-sam")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0", "curl")
    .pip_install(
        "torch",
        "torchvision",
        "transformers==4.53.2",
        "addict",
        "yapf",
        "timm",
        "numpy",
        "opencv-python",
        "supervision",
        "pycocotools",
        "matplotlib",
        "onnxruntime",
        "onnx",
        "bottleneck==1.3.5",
        "fastapi[standard]"
    )
    .run_commands(
        "mkdir -p /weights",
        "python -c \"from huggingface_hub import snapshot_download; snapshot_download('bert-base-uncased', cache_dir='/weights/hf_cache')\"",
    )
    .env({"TRANSFORMERS_CACHE": "/weights/hf_cache"})
    .run_commands(
        "curl -L -o /weights/groundingdino_swint_ogc.pth "
        "https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth",
        "curl -L -o /weights/sam_vit_h_4b8939.pth "
        "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth",
    )
    .add_local_dir(
        str(LOCAL_DIR / "groundingdino"),
        remote_path="/root/groundingdino",
        copy=True,
    )
    .add_local_dir(
        str(LOCAL_DIR / "segment_anything"),
        remote_path="/root/segment_anything",
        copy=True,
    )
)


@app.cls(
    gpu="H100",
    image=image,
    timeout=300,
)
class GroundedSAM:
    @modal.enter()
    def load_models(self):
        import sys
        sys.path.insert(0, "/root")

        import torch
        from groundingdino.util.inference import Model
        from segment_anything import sam_model_registry, SamPredictor

        self.device = "cuda"

        self.grounding_dino_model = Model(
            model_config_path="/root/groundingdino/config/GroundingDINO_SwinT_OGC.py",
            model_checkpoint_path="/weights/groundingdino_swint_ogc.pth",
            device=self.device,
        )

        sam = sam_model_registry["vit_h"](checkpoint="/weights/sam_vit_h_4b8939.pth")
        sam.to(device=self.device)
        self.sam_predictor = SamPredictor(sam)

    @modal.method()
    def segment(self, image_bytes: bytes, classes: list[str]) -> dict:
        import cv2
        import numpy as np
        import torch
        import torchvision

        # Decode image from PNG bytes
        buf = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(buf, cv2.IMREAD_COLOR)

        BOX_THRESHOLD = 0.25
        TEXT_THRESHOLD = 0.25
        NMS_THRESHOLD = 0.8

        # Detect objects with GroundingDINO
        detections = self.grounding_dino_model.predict_with_classes(
            image=image,
            classes=classes,
            box_threshold=BOX_THRESHOLD,
            text_threshold=TEXT_THRESHOLD,
        )

        # NMS post-processing
        nms_idx = (
            torchvision.ops.nms(
                torch.from_numpy(detections.xyxy),
                torch.from_numpy(detections.confidence),
                NMS_THRESHOLD,
            )
            .numpy()
            .tolist()
        )
        detections.xyxy = detections.xyxy[nms_idx]
        detections.confidence = detections.confidence[nms_idx]
        detections.class_id = detections.class_id[nms_idx]

        # Segment with SAM
        self.sam_predictor.set_image(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        cropped_masks = []
        for box in detections.xyxy:
            masks, scores, _ = self.sam_predictor.predict(
                box=box, multimask_output=True
            )
            best_mask = masks[np.argmax(scores)]

            # Crop mask to bounding box
            x1, y1, x2, y2 = map(int, box)
            cropped_masks.append(best_mask[y1:y2, x1:x2].tolist())

        # Draw bounding boxes and labels on the image
        annotated = image.copy()
        for i, box in enumerate(detections.xyxy):
            x1, y1, x2, y2 = map(int, box)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
            class_id = detections.class_id[i]
            label = classes[class_id] if class_id < len(classes) else str(class_id)
            conf = detections.confidence[i]
            cv2.putText(annotated, f"{label} {conf:.2f}", (x1, y1 - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        _, annotated_png = cv2.imencode(".png", annotated)
        annotated_b64 = base64.b64encode(annotated_png.tobytes()).decode()

        return {
            "annotated_image_b64": annotated_b64,
            "xyxy": detections.xyxy.tolist(),
            "confidence": detections.confidence.tolist(),
            "class_id": detections.class_id.tolist(),
            "masks": cropped_masks,
        }

    @modal.fastapi_endpoint(method="POST")
    def segment_endpoint(self, payload: dict) -> dict:
        image_bytes = base64.b64decode(payload["image_b64"])
        classes = payload["classes"]
        return self.segment(image_bytes, classes)
