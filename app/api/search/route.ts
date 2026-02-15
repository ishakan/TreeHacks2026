import { NextResponse } from "next/server";

import { getDefaultAssetTitle } from "@/lib/asset-title";
import { auth } from "@/lib/auth";
import db from "@/lib/db";

export const runtime = "nodejs";

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS_PER_TYPE = 6;

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const query = searchParams.get("q")?.trim() ?? "";

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ projects: [], assets: [] });
  }

  const [projects, assets] = await Promise.all([
    db.project.findMany({
      where: {
        ownerId: session.user.id,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_RESULTS_PER_TYPE,
      select: {
        id: true,
        name: true,
        description: true,
      },
    }),
    db.asset.findMany({
      where: {
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
        AND: [
          {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { fileName: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: MAX_RESULTS_PER_TYPE,
      select: {
        id: true,
        title: true,
        fileName: true,
        mimeType: true,
      },
    }),
  ]);

  return NextResponse.json({
    projects,
    assets: assets.map((asset) => ({
      ...asset,
      title: asset.title.trim() || getDefaultAssetTitle(asset.fileName),
    })),
  });
}
