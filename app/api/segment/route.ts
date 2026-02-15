import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSegmentationBaseUrl } from "@/lib/segmentation-url";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let baseUrl: string;
  try {
    baseUrl = getSegmentationBaseUrl();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "SEGMENTATION_URL is not configured.",
      },
      { status: 500 },
    );
  }

  const incoming = await request.formData();
  const file = incoming.get("file");
  const classes = incoming.get("classes");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing file field: file" },
      { status: 400 },
    );
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name);
  if (typeof classes === "string") {
    upstreamForm.append("classes", classes);
  }

  const upstreamResponse = await fetch(`${baseUrl}/api/segment`, {
    method: "POST",
    body: upstreamForm,
  });

  const payloadText = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    return new Response(payloadText, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type":
          upstreamResponse.headers.get("content-type") ?? "application/json",
      },
    });
  }

  return new Response(payloadText, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
