"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { requireSession } from "@/lib/session";

export async function createProjectAction(formData: FormData) {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) {
    throw new Error("Project name is required");
  }

  await db.project.create({
    data: {
      name,
      description: description || null,
      ownerId: session.user.id,
      scene: {
        create: {
          data: { objects: [] },
        },
      },
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/projects");
}

export async function updateProjectSettingsAction(formData: FormData) {
  const session = await requireSession();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "PRIVATE").trim();

  if (!projectId) {
    throw new Error("Project id is required");
  }

  if (!name) {
    throw new Error("Project name is required");
  }

  await db.project.updateMany({
    where: {
      id: projectId,
      ownerId: session.user.id,
    },
    data: {
      name,
      description: description || null,
      visibility:
        visibility === "PUBLIC"
          ? "PUBLIC"
          : visibility === "UNLISTED"
            ? "UNLISTED"
            : "PRIVATE",
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}
