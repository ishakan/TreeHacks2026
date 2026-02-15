export function getDefaultAssetTitle(fileName: string) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "Untitled asset";
  }

  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) {
    return trimmed;
  }

  const base = trimmed.slice(0, lastDot).trim();
  return base || trimmed;
}
