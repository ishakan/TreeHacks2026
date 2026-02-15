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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: session.user.id },
    select: {
      id: true,
      assets: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ assets: project.assets });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: session.user.id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
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
  const uploadRoot = path.join(process.cwd(), ".uploads", projectId);
  await mkdir(uploadRoot, { recursive: true });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedFileName = `${randomUUID()}-${safeName}`;
  const storagePath = path.join(uploadRoot, storedFileName);

  await writeFile(storagePath, bytes);

  const asset = await db.asset.create({
    data: {
      ownerId: session.user.id,
      projects: {
        connect: [{ id: projectId }],
      },
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const payload = (await request.json().catch(() => null)) as
    | {
        assetId?: unknown;
      }
    | null;
  const assetId = String(payload?.assetId ?? "").trim();

  if (!assetId) {
    return NextResponse.json({ error: "Asset id is required" }, { status: 400 });
  }

  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: session.user.id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const asset = await db.asset.findFirst({
    where: {
      id: assetId,
      OR: [
        { ownerId: session.user.id },
        { projects: { some: { ownerId: session.user.id } } },
      ],
    },
    select: { id: true },
  });

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  await db.project.update({
    where: { id: projectId },
    data: {
      assets: {
        connect: [{ id: assetId }],
      },
    },
  });

  return NextResponse.json({ ok: true });
}
