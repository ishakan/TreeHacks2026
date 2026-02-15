import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import { getProjectsForUser } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await getProjectsForUser(session.user.id);
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | {
        name?: unknown;
        description?: unknown;
        visibility?: unknown;
      }
    | null;

  const name = String(payload?.name ?? "").trim();
  const description = String(payload?.description ?? "").trim();
  const visibility = String(payload?.visibility ?? "PRIVATE").trim();

  if (!name) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  const project = await db.project.create({
    data: {
      ownerId: session.user.id,
      name,
      description: description || null,
      visibility:
        visibility === "PUBLIC"
          ? "PUBLIC"
          : visibility === "UNLISTED"
            ? "UNLISTED"
            : "PRIVATE",
    },
    select: {
      id: true,
      name: true,
      description: true,
      visibility: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
