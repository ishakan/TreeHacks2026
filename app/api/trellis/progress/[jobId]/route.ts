import { auth } from "@/lib/auth";
import { getTrellisBaseUrl } from "@/lib/trellis-url";

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

  const upstreamResponse = await fetch(`${baseUrl}/api/progress/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Connection: "keep-alive",
    },
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("content-type") ?? "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
