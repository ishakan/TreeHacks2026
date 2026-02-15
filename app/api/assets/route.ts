import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { auth } from "@/lib/auth";
import { getDefaultAssetTitle } from "@/lib/asset-title";
import { resolveModelMimeType } from "@/lib/model-mime";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("model");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field: model" }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const uploadRoot = path.join(process.cwd(), ".uploads", "assets", session.user.id);
  await mkdir(uploadRoot, { recursive: true });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedFileName = `${randomUUID()}-${safeName}`;
  const storagePath = path.join(uploadRoot, storedFileName);

  await writeFile(storagePath, bytes);

  const asset = await db.asset.create({
    data: {
      ownerId: session.user.id,
      title: getDefaultAssetTitle(file.name),
      fileName: file.name,
      mimeType: resolveModelMimeType({
        fileName: file.name,
        mimeType: file.type,
      }),
      sizeBytes: file.size,
      storagePath,
    },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
