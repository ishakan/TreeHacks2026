import { rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { getAssetForUser } from "@/lib/projects";

export const runtime = "nodejs";

function getThumbnailPath(userId: string, assetId: string) {
  return path.join(process.cwd(), ".uploads", "thumbnails", userId, `${assetId}.png`);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const asset = await getAssetForUser(assetId, session.user.id);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  await db.asset.delete({
    where: { id: assetId },
  });

  await Promise.allSettled([
    rm(asset.storagePath, { force: true }),
    rm(getThumbnailPath(session.user.id, assetId), { force: true }),
  ]);

  return NextResponse.json({ ok: true });
}
