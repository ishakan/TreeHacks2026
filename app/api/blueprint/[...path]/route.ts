import { auth } from "@/lib/auth";
import { getSegmentationBaseUrl } from "@/lib/segmentation-url";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
const MAX_SCAD_CHARS = 250_000;
const RENDER_TIMEOUT_MS = 30_000;

function isAllowedPath(method: string, path: string[]) {
  if (method === "POST") {
    return ["generate", "refine", "confirm", "refine-code", "render"].includes(
      path.join("/"),
    );
  }
  if (method === "GET") {
    return path.length === 2 && path[0] === "session";
  }
  if (method === "PUT") {
    return (
      path.length === 2 &&
      (path[0] === "dimensions" || path[0] === "parameters")
    );
  }
  return false;
}

async function proxyBlueprint(
  request: Request,
  path: string[],
  method: "GET" | "POST" | "PUT",
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!isAllowedPath(method, path)) {
    return new Response("Not found", { status: 404 });
  }

  let baseUrl: string;
  try {
    baseUrl = getSegmentationBaseUrl();
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "SEGMENTATION_URL is not configured.",
      { status: 500 },
    );
  }

  const contentType = request.headers.get("content-type");
  const upstreamResponse = await fetch(
    `${baseUrl}/api/blueprint/${path.map(encodeURIComponent).join("/")}`,
    {
      method,
      headers:
        method === "GET"
          ? undefined
          : {
              ...(contentType ? { "Content-Type": contentType } : {}),
            },
      body: method === "GET" ? undefined : await request.text(),
    },
  );

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type":
        upstreamResponse.headers.get("content-type") ?? "application/json",
      ...(upstreamResponse.headers.get("cache-control")
        ? { "Cache-Control": upstreamResponse.headers.get("cache-control") as string }
        : {}),
      ...(upstreamResponse.headers.get("connection")
        ? { Connection: upstreamResponse.headers.get("connection") as string }
        : {}),
    },
  });
}

async function runOpenScad(inputPath: string, outputPath: string) {
  await new Promise<void>((resolve, reject) => {
    const process = spawn("openscad", ["-o", outputPath, inputPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      process.kill("SIGKILL");
    }, RENDER_TIMEOUT_MS);

    process.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    process.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    process.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error("OpenSCAD render timed out."));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() || `OpenSCAD process failed with exit code ${code}.`,
          ),
        );
        return;
      }

      resolve();
    });
  });
}

async function renderBlueprintLocally(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as {
    scadCode?: unknown;
  } | null;

  const scadCode =
    payload && typeof payload.scadCode === "string" ? payload.scadCode : "";

  if (!scadCode.trim()) {
    return Response.json({ error: "Missing OpenSCAD code." }, { status: 400 });
  }

  if (scadCode.length > MAX_SCAD_CHARS) {
    return Response.json(
      { error: "OpenSCAD code is too large." },
      { status: 413 },
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "blueprint-render-"));
  const inputPath = join(workDir, "model.scad");
  const outputPath = join(workDir, "model.stl");

  try {
    await writeFile(inputPath, scadCode, "utf8");
    await runOpenScad(inputPath, outputPath);
    const stlBuffer = await readFile(outputPath);

    if (!stlBuffer.length) {
      throw new Error("OpenSCAD render produced an empty file.");
    }

    return new Response(stlBuffer, {
      status: 200,
      headers: {
        "Content-Type": "model/stl",
        "Cache-Control": "no-store",
        "Content-Disposition": 'inline; filename="model.stl"',
      },
    });
  } catch (error) {
    const maybeErr = error as { code?: string; message?: string };
    if (maybeErr.code === "ENOENT") {
      return Response.json(
        { error: "OpenSCAD CLI is not installed on the server." },
        { status: 501 },
      );
    }

    return Response.json(
      { error: maybeErr.message ?? "OpenSCAD render failed." },
      { status: 500 },
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyBlueprint(request, path, "GET");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (path.length === 1 && path[0] === "render") {
    return renderBlueprintLocally(request);
  }
  return proxyBlueprint(request, path, "POST");
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxyBlueprint(request, path, "PUT");
}
