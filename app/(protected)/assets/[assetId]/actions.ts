"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function updateAssetDetailsAction(formData: FormData) {
  const session = await requireSession();
  const assetId = String(formData.get("assetId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!assetId) {
    throw new Error("Asset id is required");
  }

  if (!title) {
    throw new Error("Title is required");
  }

  await db.asset.updateMany({
    where: {
      id: assetId,
      OR: [
        { ownerId: session.user.id },
        { projects: { some: { ownerId: session.user.id } } },
      ],
    },
    data: {
      title,
      description: description || null,
    },
  });

  revalidatePath("/assets");
  revalidatePath(`/assets/${assetId}`);
}
