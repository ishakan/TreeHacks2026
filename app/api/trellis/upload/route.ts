import { NextResponse } from "next/server";
import db from "@/lib/db";
import { auth } from "@/lib/auth";
import { registerTrellisJob } from "@/lib/trellis-jobs";
import { getTrellisBaseUrl } from "@/lib/trellis-url";
import { getDefaultAssetTitle } from "@/lib/asset-title";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let baseUrl: string;
  try {
    baseUrl = getTrellisBaseUrl();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TRELLIS_URL missing" },
      { status: 500 }
    );
  }

  const incoming = await request.formData();
  const file = incoming.get("file");
  const projectIdRaw = incoming.get("projectId");
  const titleRaw = incoming.get("title");
  const descriptionRaw = incoming.get("description");
  const resolutionRaw = incoming.get("resolution");
  const resolution = Number.isFinite(Number(resolutionRaw)) ? Number(resolutionRaw) : 512;
  const projectId =
    typeof projectIdRaw === "string" && projectIdRaw.trim().length > 0
      ? projectIdRaw.trim()
      : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field: file" }, { status: 400 });
  }

  const title =
    typeof titleRaw === "string" && titleRaw.trim().length > 0
      ? titleRaw.trim()
      : getDefaultAssetTitle(file.name);
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw.trim()
      : null;

  if (projectId) {
    const project = await db.project.findFirst({
      where: {
        id: projectId,
        ownerId: session.user.id,
      },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name);

  const upstreamResponse = await fetch(
    `${baseUrl}/api/upload?resolution=${encodeURIComponent(String(resolution))}`,
    {
      method: "POST",
      body: upstreamForm,
    }
  );

  const payloadText = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    return new Response(payloadText, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("content-type") ?? "application/json",
      },
    });
  }

  const payload = JSON.parse(payloadText) as { job_id?: string };
  if (!payload.job_id) {
    return NextResponse.json({ error: "Invalid response from TRELLIS server." }, { status: 502 });
  }

  registerTrellisJob({
    jobId: payload.job_id,
    userId: session.user.id,
    projectId,
    title,
    description,
  });

  return NextResponse.json({ job_id: payload.job_id });
}
