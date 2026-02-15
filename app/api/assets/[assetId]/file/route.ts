import { readFile } from "node:fs/promises";
import { auth } from "@/lib/auth";
import { getAssetForUser } from "@/lib/projects";
import { resolveModelMimeType } from "@/lib/model-mime";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { assetId } = await params;
  const asset = await getAssetForUser(assetId, session.user.id);

  if (!asset) {
    return new Response("Asset not found", { status: 404 });
  }

  try {
    const bytes = await readFile(asset.storagePath);
    const contentType = resolveModelMimeType({
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    });
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename=\"${asset.fileName}\"`,
      },
    });
  } catch {
    return new Response("Asset file missing", { status: 404 });
  }
}
