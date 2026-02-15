export function getTrellisBaseUrl() {
  const raw = process.env.TRELLIS_URL?.trim();

  if (!raw) {
    throw new Error("TRELLIS_URL is not configured.");
  }

  return raw.replace(/\/$/, "");
}
