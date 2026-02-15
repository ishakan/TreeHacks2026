import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { getAssetForUser } from "@/lib/projects";

export const runtime = "nodejs";

function getThumbnailPath(userId: string, assetId: string) {
  return path.join(process.cwd(), ".uploads", "thumbnails", userId, `${assetId}.png`);
}

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

  const thumbnailPath = getThumbnailPath(session.user.id, assetId);

  try {
    const bytes = await readFile(thumbnailPath);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=31536000",
      },
    });
  } catch {
    return new Response("Thumbnail not found", { status: 404 });
  }
}

export async function POST(
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

  const body = (await request.json().catch(() => null)) as { dataUrl?: string } | null;
  const dataUrl = body?.dataUrl;

  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) {
    return new Response("Invalid thumbnail payload", { status: 400 });
  }

  const base64 = dataUrl.slice("data:image/png;base64,".length);
  const bytes = Buffer.from(base64, "base64");

  const thumbnailPath = getThumbnailPath(session.user.id, assetId);
  await mkdir(path.dirname(thumbnailPath), { recursive: true });
  await writeFile(thumbnailPath, bytes);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
