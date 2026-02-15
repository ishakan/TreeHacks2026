import cv2 as cv
import supervision as sv
import grounded_sam
import geometric_extraction

def annotate_image(detections, image, classes, output_path="grounded_sam_annotated_image.jpg"):
    box_annotator = sv.BoxAnnotator()
    mask_annotator = sv.MaskAnnotator()

    # Generate labels for each detection
    labels = [
        f"{classes[class_id]} {confidence:0.2f}"
        for _, _, confidence, class_id, _, _
        in detections
    ]

    # Annotate image with masks and boxes
    annotated_image = mask_annotator.annotate(scene=image.copy(), detections=detections)
    annotated_image = box_annotator.annotate(scene=annotated_image, detections=detections)

    # Save the annotated image
    cv.imwrite(output_path, annotated_image)

    return annotated_image


if __name__ == "__main__":
    # # Demo configuration
    # image_path = "furniture.jpg"  # Change this to your image path
    # classes_to_detect = ["cushion", "table", "chair", "couch"]  # Change this to your desired classes
    # output_path = "grounded_sam_annotated_image.jpg"

    # print(f"Running Grounded-SAM on: {image_path}")
    # print(f"Detecting classes: {classes_to_detect}")

    # # Step 1: Segment image using Grounded-SAM
    # detections, image, classes = grounded_sam.segment_image(image_path, classes_to_detect)

    # # Print detection statistics
    # print(f"\nDetection Results:")
    # print(f"  Total detections: {len(detections.xyxy)}")
    # print(f"  Image shape: {image.shape}")

    # # Step 2: Annotate the image with detections
    # annotated_image = annotate_image(detections, image, classes, output_path)

    # print(f"\nAnnotated image saved to: {output_path}")
    
    image_path = "fire_hydrant.jpg"
    img = cv.imread(image_path)
    height, width, channels = img.shape
    contours = geometric_extraction.extract_contours(img=img, min_perimeter=(height+width)/30, min_area= height*width/400)
    paths = geometric_extraction.contours_to_smooth_svg(contours=contours, smoothing=0.5)
    
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">
        {paths}</svg>"""
    with open("guidelines.svg", "w") as f:
        f.write(svg)

