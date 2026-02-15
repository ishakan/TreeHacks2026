import { NextResponse } from "next/server";

import { getDefaultAssetTitle } from "@/lib/asset-title";
import { auth } from "@/lib/auth";
import db from "@/lib/db";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const projectId = params.get("projectId")?.trim() ?? "";
  const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);
  const limitRaw = Number.parseInt(params.get("limit") ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, limitRaw));

  const records = await db.asset.findMany({
    where: {
      AND: [
        {
          ...(projectId
            ? {
                projects: {
                  some: {
                    id: projectId,
                    ownerId: session.user.id,
                  },
                },
              }
            : {
                OR: [
                  { ownerId: session.user.id },
                  {
                    projects: {
                      some: {
                        ownerId: session.user.id,
                      },
                    },
                  },
                ],
              }),
        },
        {
          OR: [
            { fileName: { endsWith: ".stl", mode: "insensitive" } },
            { fileName: { endsWith: ".glb", mode: "insensitive" } },
            { fileName: { endsWith: ".gltf", mode: "insensitive" } },
            { mimeType: { contains: "model/stl", mode: "insensitive" } },
            { mimeType: { contains: "model/gltf-binary", mode: "insensitive" } },
            { mimeType: { contains: "model/gltf+json", mode: "insensitive" } },
          ],
        },
        ...(query
          ? [
              {
                OR: [
                  { title: { contains: query, mode: "insensitive" as const } },
                  { fileName: { contains: query, mode: "insensitive" as const } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    skip: page * limit,
    take: limit + 1,
    select: {
      id: true,
      title: true,
      fileName: true,
      mimeType: true,
    },
  });

  return NextResponse.json({
    assets: records.slice(0, limit).map((asset) => ({
      id: asset.id,
      title: asset.title.trim() || getDefaultAssetTitle(asset.fileName),
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      url: `/api/assets/${asset.id}/file`,
    })),
    hasMore: records.length > limit,
    page,
    limit,
    query,
    projectId: projectId || null,
  });
}
