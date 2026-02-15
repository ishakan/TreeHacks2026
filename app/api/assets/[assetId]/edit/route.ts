import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { auth } from "@/lib/auth";
import { getTrellisBaseUrl } from "@/lib/trellis-url";
import { resolveModelMimeType } from "@/lib/model-mime";

export const runtime = "nodejs";

type EditRequestPayload = {
  instruction?: unknown;
  history?: unknown;
  glbFilename?: unknown;
};

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(-20);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const payload = (await request.json().catch(() => null)) as EditRequestPayload | null;
  const instruction = trimString(payload?.instruction);
  const history = normalizeHistory(payload?.history);
  const requestedGlbFilename = trimString(payload?.glbFilename);

  if (!instruction) {
    return NextResponse.json({ error: "Edit instruction is required." }, { status: 400 });
  }

  let baseUrl: string;
  try {
    baseUrl = getTrellisBaseUrl();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TRELLIS_URL missing" },
      { status: 500 },
    );
  }

  const sourceAsset = await db.asset.findFirst({
    where: {
      id: assetId,
      OR: [
        { ownerId: session.user.id },
        { projects: { some: { ownerId: session.user.id } } },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      projects: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!sourceAsset) {
    return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  }

  const localBaseName = path.basename(sourceAsset.storagePath);
  const localExt = path.extname(localBaseName).toLowerCase();
  const isGlb = localExt === ".glb" || sourceAsset.mimeType.includes("gltf-binary");
  if (!isGlb) {
    return NextResponse.json(
      { error: "Only GLB assets can be edited through TRELLIS edit-model." },
      { status: 400 },
    );
  }

  const glbFilename = requestedGlbFilename || localBaseName;

  const editResponse = await fetch(`${baseUrl}/api/edit-model`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      glb_filename: glbFilename,
      instruction,
      history,
    }),
  });

  if (!editResponse.ok) {
    const detailText = await editResponse.text();
    return new Response(detailText || "Edit request failed.", {
      status: editResponse.status,
      headers: {
        "Content-Type": editResponse.headers.get("content-type") ?? "text/plain",
      },
    });
  }

  const editPayload = (await editResponse.json().catch(() => null)) as
    | {
        glb_filename?: unknown;
        message?: unknown;
      }
    | null;

  const editedGlbFilename = trimString(editPayload?.glb_filename);
  if (!editedGlbFilename) {
    return NextResponse.json(
      { error: "Invalid response from TRELLIS edit-model endpoint." },
      { status: 502 },
    );
  }

  const editedModelResponse = await fetch(
    `${baseUrl}/api/models/${encodeURIComponent(editedGlbFilename)}`,
    {
      method: "GET",
    },
  );

  if (!editedModelResponse.ok) {
    const detailText = await editedModelResponse.text();
    return new Response(detailText || "Failed to download edited model.", {
      status: editedModelResponse.status,
      headers: {
        "Content-Type": editedModelResponse.headers.get("content-type") ?? "text/plain",
      },
    });
  }

  const modelBytes = Buffer.from(await editedModelResponse.arrayBuffer());
  const extension = path.extname(editedGlbFilename).toLowerCase() || ".glb";
  const fileStem = path.parse(sourceAsset.fileName).name || "asset";
  const savedFileName = editedGlbFilename;
  const storageRoot = path.join(process.cwd(), ".uploads", "trellis-edits", session.user.id);
  await mkdir(storageRoot, { recursive: true });
  const storagePath = path.join(storageRoot, savedFileName);
  await writeFile(storagePath, modelBytes);

  const upstreamContentType = editedModelResponse.headers.get("content-type");
  const mimeType = resolveModelMimeType({
    fileName: savedFileName,
    mimeType: upstreamContentType || sourceAsset.mimeType,
    fallback: "model/gltf-binary",
  });

  const existingTitle = sourceAsset.title.trim();
  const nextTitle = existingTitle.length > 0 ? `${existingTitle} (Edited)` : `${fileStem} (Edited)`;

  const createdAsset = await db.asset.create({
    data: {
      ownerId: session.user.id,
      title: nextTitle,
      description: sourceAsset.description,
      fileName: savedFileName,
      mimeType,
      sizeBytes: modelBytes.byteLength,
      storagePath,
      ...(sourceAsset.projects.length > 0
        ? {
            projects: {
              connect: sourceAsset.projects.map((project) => ({ id: project.id })),
            },
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      success: true,
      message:
        trimString(editPayload?.message) ||
        `Edit applied: ${instruction}`,
      glbFilename: editedGlbFilename,
      asset: createdAsset,
    },
    { status: 200 },
  );
}
