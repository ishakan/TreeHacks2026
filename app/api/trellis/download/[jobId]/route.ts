import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { getTrellisJobMeta, markTrellisJobPersisted } from "@/lib/trellis-jobs";
import { getTrellisBaseUrl } from "@/lib/trellis-url";
import { getDefaultAssetTitle } from "@/lib/asset-title";
import { resolveModelMimeType } from "@/lib/model-mime";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  let baseUrl: string;
  try {
    baseUrl = getTrellisBaseUrl();
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "TRELLIS_URL missing", {
      status: 500,
    });
  }

  const { jobId } = await params;
  const jobMeta = getTrellisJobMeta(jobId);
  const titleFromHeader = request.headers.get("x-asset-title")?.trim() ?? "";
  const descriptionFromHeader = request.headers.get("x-asset-description")?.trim() ?? "";

  if (jobMeta && jobMeta.userId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  if (jobMeta?.storagePath) {
    try {
      const localBytes = await readFile(jobMeta.storagePath);
      const localFileName = `model-${jobId.slice(0, 8)}.glb`;
      return new Response(localBytes, {
        status: 200,
        headers: {
          "Content-Type": resolveModelMimeType({
            fileName: localFileName,
            mimeType: "model/gltf-binary",
          }),
          ...(jobMeta.persistedAssetId ? { "x-asset-id": jobMeta.persistedAssetId } : {}),
          "Content-Disposition": `attachment; filename=\"${localFileName}\"`,
        },
      });
    } catch {
      // Fall through to upstream download if local file is unavailable.
    }
  }

  const upstreamResponse = await fetch(`${baseUrl}/api/download/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });

  if (!upstreamResponse.ok) {
    const text = await upstreamResponse.text();
    return new Response(text, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("content-type") ?? "text/plain",
      },
    });
  }

  const bytes = Buffer.from(await upstreamResponse.arrayBuffer());
  const contentType =
    upstreamResponse.headers.get("content-type") ?? "model/gltf-binary";
  const disposition = upstreamResponse.headers.get("content-disposition") ?? "";
  const extFromDisposition = disposition.match(/filename=\"?[^\"]*(\.[a-zA-Z0-9]+)\"?/i)?.[1];
  const ext =
    extFromDisposition?.toLowerCase() ??
    (contentType.includes("obj") ? ".obj" : ".glb");
  const fileName = `trellis-${jobId.slice(0, 8)}${ext}`;
  const resolvedContentType = resolveModelMimeType({
    fileName,
    mimeType: contentType,
    fallback: "model/gltf-binary",
  });
  const fallbackTitle = getDefaultAssetTitle(fileName);
  const resolvedTitle = titleFromHeader || jobMeta?.title?.trim() || fallbackTitle;
  const resolvedDescription =
    descriptionFromHeader || jobMeta?.description?.trim() || null;

  const uploadRoot = path.join(process.cwd(), ".uploads", "trellis", session.user.id);
  await mkdir(uploadRoot, { recursive: true });
  const storagePath = path.join(uploadRoot, `${jobId}${ext}`);
  await writeFile(storagePath, bytes);

  const existingAsset = await db.asset.findFirst({
    where: {
      storagePath,
      OR: [{ ownerId: session.user.id }, { projects: { some: { ownerId: session.user.id } } }],
    },
    select: { id: true },
  });

  const asset = existingAsset
    ? await db.asset.update({
        where: { id: existingAsset.id },
        data: {
          title: resolvedTitle,
          description: resolvedDescription,
        },
        select: { id: true },
      })
    : await db.asset.create({
        data: {
          ownerId: session.user.id,
          ...(jobMeta?.projectId
            ? {
                projects: {
                  connect: [{ id: jobMeta.projectId }],
                },
              }
            : {}),
          fileName,
          title: resolvedTitle,
          description: resolvedDescription,
          mimeType: resolvedContentType,
          sizeBytes: bytes.byteLength,
          storagePath,
        },
        select: { id: true },
      });

  markTrellisJobPersisted({
    jobId,
    assetId: asset.id,
    storagePath,
  });

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": resolvedContentType,
      "x-asset-id": asset.id,
      "Content-Disposition":
        upstreamResponse.headers.get("content-disposition") ??
        `attachment; filename=\"model-${jobId.slice(0, 8)}.glb\"`,
    },
  });
}
