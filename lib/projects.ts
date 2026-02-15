import db from "@/lib/db";
import { getDefaultAssetTitle } from "@/lib/asset-title";

export async function getProjectsForUser(userId: string) {
  return db.project.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      visibility: true,
      updatedAt: true,
      _count: {
        select: { assets: true },
      },
    },
  });
}

export async function getProjectForUser(projectId: string, userId: string) {
  return db.project.findFirst({
    where: {
      id: projectId,
      ownerId: userId,
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
}

export async function getAssetsForUser(userId: string) {
  return db.asset.findMany({
    where: {
      OR: [
        { ownerId: userId },
        {
          projects: {
            some: {
              ownerId: userId,
            },
          },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      projects: {
        select: {
          id: true,
          name: true,
          visibility: true,
        },
      },
    },
  });
}

export async function getAssetForUser(assetId: string, userId: string) {
  return db.asset.findFirst({
    where: {
      id: assetId,
      OR: [
        { ownerId: userId },
        {
          projects: {
            some: {
              ownerId: userId,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      storagePath: true,
      createdAt: true,
      projects: {
        select: {
          id: true,
          name: true,
          visibility: true,
        },
      },
    },
  });
}

export function getAssetDisplayTitle(asset: { title: string; fileName: string }) {
  return asset.title.trim() || getDefaultAssetTitle(asset.fileName);
}
