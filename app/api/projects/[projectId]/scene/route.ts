import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import db from "@/lib/db";
import type { Prisma } from "@/prisma/generated/client";

export const runtime = "nodejs";

type StudioSceneData = {
  objects: Prisma.InputJsonValue[];
};

const DEFAULT_SCENE: StudioSceneData = {
  objects: [],
};

function normalizeSceneData(value: unknown): StudioSceneData {
  if (!value || typeof value !== "object") {
    return DEFAULT_SCENE;
  }

  const raw = value as Record<string, unknown>;
  return {
    objects: Array.isArray(raw.objects)
      ? (raw.objects as Prisma.InputJsonValue[])
      : [],
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: session.user.id },
    select: {
      id: true,
      scene: {
        select: {
          data: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const scene = project.scene
    ? project.scene
    : await db.projectScene.create({
        data: {
          projectId,
          data: DEFAULT_SCENE,
        },
        select: {
          data: true,
          updatedAt: true,
        },
      });

  return NextResponse.json({
    scene: normalizeSceneData(scene.data),
    updatedAt: scene.updatedAt,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });

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

  const payload = (await request.json().catch(() => null)) as
    | {
        scene?: unknown;
      }
    | null;

  const sceneData = normalizeSceneData(payload?.scene);

  const scene = await db.projectScene.upsert({
    where: { projectId },
    create: {
      projectId,
      data: sceneData,
    },
    update: {
      data: sceneData,
    },
    select: {
      data: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    scene: normalizeSceneData(scene.data),
    updatedAt: scene.updatedAt,
  });
}
