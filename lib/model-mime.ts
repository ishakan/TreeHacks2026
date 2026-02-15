import path from "node:path";

const MODEL_MIME_BY_EXTENSION: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "model/obj",
  ".stl": "model/stl",
  ".step": "model/step",
  ".stp": "model/step",
  ".iges": "model/iges",
  ".igs": "model/iges",
};

function normalizeMimeType(input: string | null | undefined) {
  if (!input) {
    return null;
  }

  const normalized = input.split(";")[0]?.trim().toLowerCase();
  return normalized || null;
}

export function inferModelMimeTypeFromName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return MODEL_MIME_BY_EXTENSION[ext] ?? null;
}

export function resolveModelMimeType({
  fileName,
  mimeType,
  fallback = "application/octet-stream",
}: {
  fileName: string;
  mimeType?: string | null;
  fallback?: string;
}) {
  const normalized = normalizeMimeType(mimeType);
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }

  return inferModelMimeTypeFromName(fileName) ?? normalized ?? fallback;
}
