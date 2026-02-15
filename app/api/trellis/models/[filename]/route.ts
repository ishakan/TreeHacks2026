import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { readFile } from "node:fs/promises";
import { resolveModelMimeType } from "@/lib/model-mime";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { filename: modelId } = await params;

  const asset = await db.asset.findFirst({
    where: {
      id: modelId,
      OR: [{ ownerId: session.user.id }, { projects: { some: { ownerId: session.user.id } } }],
    },
    select: {
      fileName: true,
      mimeType: true,
      storagePath: true,
    },
  });

  if (!asset) {
    return new Response("Model not found", { status: 404 });
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
    return new Response("Model not found", { status: 404 });
  }
}
