import { auth } from "@/lib/auth";
import db from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const models = await db.asset.findMany({
    where: {
      OR: [{ ownerId: session.user.id }, { projects: { some: { ownerId: session.user.id } } }],
      mimeType: {
        startsWith: "model/",
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      sizeBytes: true,
      createdAt: true,
    },
  });

  return new Response(
    JSON.stringify(
      models.map((model) => ({
        id: model.id,
        name: model.fileName,
        size: model.sizeBytes,
        created: model.createdAt.getTime(),
      }))
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}
