import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { getDefaultAssetTitle } from "@/lib/asset-title";

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN ?? "";
const REPLICATE_MODEL = process.env.REPLICATE_MODEL ?? "firtoz/trellis";

type JobStatus = "queued" | "processing" | "completed" | "failed";

export type TrellisJob = {
  id: string;
  userId: string;
  projectId: string | null;
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  modelPath: string | null;
  outputFileName: string | null;
  assetCreated: boolean;
  createdAt: number;
};

const jobs = new Map<string, TrellisJob>();

function updateJob(jobId: string, patch: Partial<TrellisJob>) {
  const current = jobs.get(jobId);
  if (!current) {
    return;
  }

  jobs.set(jobId, {
    ...current,
    ...patch,
  });
}

function getUserRoot(userId: string) {
  return path.join(process.cwd(), ".uploads", "trellis", userId);
}

function getOutputDir(userId: string) {
  return path.join(getUserRoot(userId), "outputs");
}

function getUploadDir(userId: string) {
  return path.join(getUserRoot(userId), "uploads");
}

export async function saveUploadImage(job: TrellisJob, bytes: Buffer, contentType: string) {
  const ext = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  const uploadDir = getUploadDir(job.userId);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, `${job.id}${ext}`), bytes);
}

export function createTrellisJob({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string | null;
}) {
  const job: TrellisJob = {
    id: randomUUID(),
    userId,
    projectId,
    status: "queued",
    progress: 0,
    message: "Queued",
    error: null,
    modelPath: null,
    outputFileName: null,
    assetCreated: false,
    createdAt: Date.now(),
  };

  jobs.set(job.id, job);
  return job;
}

async function replicateRequest(pathname: string, init?: RequestInit) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN is not configured.");
  }

  const response = await fetch(`https://api.replicate.com/v1/${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "wait",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Replicate request failed (${response.status}): ${body}`);
  }

  return response.json();
}

function pickOutputUrl(output: unknown) {
  if (typeof output === "string" && output.length > 0) {
    return output;
  }

  if (Array.isArray(output)) {
    const candidate = output.find(
      (item) => typeof item === "string" && (item.includes(".glb") || item.includes("http"))
    );
    if (typeof candidate === "string") {
      return candidate;
    }

    const last = output[output.length - 1];
    if (typeof last === "string") {
      return last;
    }
  }

  if (output && typeof output === "object") {
    const objectOutput = output as Record<string, unknown>;
    const preferredKeys = ["model_file", "model", "mesh", "glb", "output"];

    for (const key of preferredKeys) {
      const value = objectOutput[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }

    const fallback = Object.values(objectOutput).find(
      (value) => typeof value === "string" && value.includes("http")
    );

    if (typeof fallback === "string") {
      return fallback;
    }
  }

  return null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runTrellisJob({
  jobId,
  imageBytes,
  contentType,
  resolution,
}: {
  jobId: string;
  imageBytes: Buffer;
  contentType: string;
  resolution: number;
}) {
  void (async () => {
    try {
      const job = jobs.get(jobId);
      if (!job) {
        return;
      }

      updateJob(jobId, {
        status: "processing",
        progress: 8,
        message: "Uploading to TRELLIS...",
        error: null,
      });

      const dataUri = `data:${contentType};base64,${imageBytes.toString("base64")}`;

      const modelInfo = await replicateRequest(`models/${REPLICATE_MODEL}`);
      const modelVersion = modelInfo?.latest_version?.id as string | undefined;

      if (!modelVersion) {
        throw new Error("Could not determine latest TRELLIS model version.");
      }

      updateJob(jobId, {
        progress: 20,
        message: "TRELLIS is generating your model...",
      });

      let prediction = await replicateRequest("predictions", {
        method: "POST",
        body: JSON.stringify({
          version: modelVersion,
          input: {
            images: [dataUri],
            generate_color: true,
            generate_model: true,
            texture_size: resolution,
            mesh_simplify: 0.95,
            ss_sampling_steps: 12,
            slat_sampling_steps: 12,
            ss_guidance_strength: 7.5,
            slat_guidance_strength: 3.0,
          },
        }),
      });

      while (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
        await wait(1800);
        prediction = await replicateRequest(`predictions/${prediction.id}`);

        updateJob(jobId, {
          progress: Math.min(85, Math.max(25, (jobs.get(jobId)?.progress ?? 20) + 6)),
          message: "Generating 3D model on GPU...",
        });
      }

      if (prediction.status !== "succeeded") {
        throw new Error(prediction.error ?? "TRELLIS prediction failed.");
      }

      updateJob(jobId, {
        progress: 90,
        message: "Downloading model...",
      });

      const outputUrl = pickOutputUrl(prediction.output);
      if (!outputUrl) {
        throw new Error("Could not find a model file URL in TRELLIS output.");
      }

      const modelResponse = await fetch(outputUrl);
      if (!modelResponse.ok) {
        throw new Error(`Failed to download model (${modelResponse.status}).`);
      }

      const outputDir = getOutputDir(job.userId);
      await mkdir(outputDir, { recursive: true });

      const ext = outputUrl.includes(".obj") ? ".obj" : ".glb";
      const outputFileName = `${jobId}${ext}`;
      const outputPath = path.join(outputDir, outputFileName);

      const outputBytes = Buffer.from(await modelResponse.arrayBuffer());
      await writeFile(outputPath, outputBytes);

      let assetCreated = false;
      if (job.projectId) {
        await db.asset.create({
          data: {
            ownerId: job.userId,
            projects: {
              connect: [{ id: job.projectId }],
            },
            fileName: `trellis-${jobId.slice(0, 8)}${ext}`,
            title: getDefaultAssetTitle(`trellis-${jobId.slice(0, 8)}${ext}`),
            mimeType: ext === ".obj" ? "model/obj" : "model/gltf-binary",
            sizeBytes: outputBytes.byteLength,
            storagePath: outputPath,
          },
        });
        assetCreated = true;
      }

      updateJob(jobId, {
        status: "completed",
        progress: 100,
        message: assetCreated ? "Complete. Saved as project asset." : "Complete.",
        modelPath: outputPath,
        outputFileName,
        assetCreated,
      });
    } catch (error) {
      updateJob(jobId, {
        status: "failed",
        message: "Generation failed.",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  })();
}

export function getTrellisJobForUser(jobId: string, userId: string) {
  const job = jobs.get(jobId);
  if (!job || job.userId !== userId) {
    return null;
  }

  return job;
}

export async function listUserModels(userId: string) {
  const outputDir = getOutputDir(userId);
  await mkdir(outputDir, { recursive: true });

  const files = await readdir(outputDir);
  const modelFiles = files.filter((name) => name.endsWith(".glb") || name.endsWith(".obj"));

  const enriched = await Promise.all(
    modelFiles.map(async (filename) => {
      const fullPath = path.join(outputDir, filename);
      const fileStat = await stat(fullPath);
      return {
        filename,
        size: fileStat.size,
        created: fileStat.mtimeMs,
      };
    })
  );

  enriched.sort((a, b) => b.created - a.created);
  return enriched;
}

export function getModelPathForUser(userId: string, filename: string) {
  const safeName = path.basename(filename);
  if (!safeName.endsWith(".glb") && !safeName.endsWith(".obj")) {
    return null;
  }

  return path.join(getOutputDir(userId), safeName);
}
