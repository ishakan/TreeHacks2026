export function getSegmentationBaseUrl() {
  const raw = process.env.SEGMENTATION_URL?.trim();

  if (!raw) {
    throw new Error("SEGMENTATION_URL is not configured.");
  }

  return raw.replace(/\/$/, "");
}
