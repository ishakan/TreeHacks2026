"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, DownloadIcon, Sparkles } from "lucide-react";
import TrellisModelViewer from "@/components/trellis-model-viewer";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { getDefaultAssetTitle } from "@/lib/asset-title";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 10;

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type SegmentedCandidate = {
  id: string;
  label: string;
  imageFile: File;
  previewUrl: string;
};

function decodeBase64ToPngBlob(value: string) {
  const raw = value.startsWith("data:")
    ? value.slice(value.indexOf(",") + 1)
    : value;
  const byteString = atob(raw);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i += 1) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return new Blob([bytes], { type: "image/png" });
}

export default function ImageTo3DWorkbench({
  embedded = false,
  onAssetCreated,
  projectId,
}: {
  embedded?: boolean;
  onAssetCreated?: (assetId: string) => void;
  projectId?: string;
}) {
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolution, setResolution] = useState(512);

  const [status, setStatus] = useState<
    "idle" | "uploading" | "processing" | "completed" | "failed"
  >("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [assetCreated, setAssetCreated] = useState(false);
  const [generatedAssetId, setGeneratedAssetId] = useState<string | null>(null);
  const [captureSignal, setCaptureSignal] = useState(0);
  const [thumbnailSaved, setThumbnailSaved] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [segmentDialogOpen, setSegmentDialogOpen] = useState(false);
  const [segmentStep, setSegmentStep] = useState<"ask" | "configure" | "pick">(
    "ask",
  );
  const [segmentClasses, setSegmentClasses] = useState("");
  const [segmenting, setSegmenting] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [segmentCandidates, setSegmentCandidates] = useState<
    SegmentedCandidate[]
  >([]);
  const [annotatedPreview, setAnnotatedPreview] = useState<string | null>(null);
  const [annotatedDialogOpen, setAnnotatedDialogOpen] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const captureRef = useRef<(() => string | null) | null>(null);
  const uploadThumbnailRef = useRef(false);
  const downloadUrlRef = useRef<string | null>(null);

  const isProcessing = status === "uploading" || status === "processing";
  const hasGenerationStarted = status !== "idle";

  const clearSelectedImages = useCallback(() => {
    setSelectedImages((current) => {
      for (const image of current) {
        URL.revokeObjectURL(image.previewUrl);
      }
      return [];
    });
  }, []);

  const clearSegmentCandidates = useCallback(() => {
    setSegmentCandidates((current) => {
      for (const candidate of current) {
        URL.revokeObjectURL(candidate.previewUrl);
      }
      return [];
    });
    setAnnotatedPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, []);

  const resetGenerationState = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStatus("idle");
    setJobId(null);
    setProgress(0);
    setMessage("");
    setAssetCreated(false);
    setGeneratedAssetId(null);
    setThumbnailSaved(false);
    setCaptureSignal(0);
    setDownloadUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
  }, []);

  const addSelectedImage = useCallback(
    (picked: File) => {
      if (selectedImages.length >= MAX_IMAGES) {
        setError(`You can upload up to ${MAX_IMAGES} images.`);
        return;
      }

      resetGenerationState();
      setSelectedImages((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random()}`,
          file: picked,
          previewUrl: URL.createObjectURL(picked),
        },
      ]);
      setTitle((current) => current.trim() || getDefaultAssetTitle(picked.name));
      setError(null);
    },
    [resetGenerationState, selectedImages.length],
  );

  const removeSelectedImage = useCallback(
    (id: string) => {
      resetGenerationState();
      setSelectedImages((current) => {
        const target = current.find((image) => image.id === id);
        if (target) {
          URL.revokeObjectURL(target.previewUrl);
        }
        return current.filter((image) => image.id !== id);
      });
      setError(null);
    },
    [resetGenerationState],
  );

  const downloadJobResult = useCallback(
    async (activeJobId: string) => {
      const response = await fetch(`/api/trellis/download/${activeJobId}`, {
        headers: {
          "x-asset-title": title.trim(),
          "x-asset-description": description.trim(),
        },
      });
      if (!response.ok) {
        setError("Model generation finished but download failed.");
        return;
      }
      const assetId = response.headers.get("x-asset-id");
      if (assetId) {
        setGeneratedAssetId(assetId);
        setThumbnailSaved(false);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      setDownloadUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return objectUrl;
      });
    },
    [description, title],
  );

  useEffect(() => {
    if (!pendingFile) {
      setPendingPreview((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return null;
      });
      return;
    }

    const objectUrl = URL.createObjectURL(pendingFile);
    setPendingPreview((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return objectUrl;
    });
  }, [pendingFile]);

  useEffect(() => {
    downloadUrlRef.current = downloadUrl;
  }, [downloadUrl]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
      }

      clearSelectedImages();
      clearSegmentCandidates();
    };
  }, [clearSegmentCandidates, clearSelectedImages]);

  useEffect(() => {
    return () => {
      if (pendingPreview) {
        URL.revokeObjectURL(pendingPreview);
      }
    };
  }, [pendingPreview]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    const source = new EventSource(`/api/trellis/progress/${jobId}`);
    eventSourceRef.current = source;

    source.addEventListener("progress", (event) => {
      const payload = JSON.parse(event.data) as {
        status: "queued" | "processing" | "completed" | "failed";
        progress: number;
        message: string;
        error?: string | null;
        asset_created?: boolean;
      };

      setProgress(payload.progress);
      setMessage(payload.message);

      if (payload.status === "completed") {
        setStatus("completed");
        setAssetCreated(Boolean(payload.asset_created));
        source.close();
        void downloadJobResult(jobId);
        return;
      }

      if (payload.status === "failed") {
        setStatus("failed");
        setError(payload.error ?? "Generation failed.");
        source.close();
      }
    });

    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [downloadJobResult, jobId]);

  const onFilePicked = useCallback(
    (picked: File) => {
      if (selectedImages.length >= MAX_IMAGES) {
        setError(`You can upload up to ${MAX_IMAGES} images.`);
        return;
      }

      if (!ACCEPTED_TYPES.includes(picked.type)) {
        setError("Please upload a JPEG, PNG, or WebP image.");
        return;
      }

      if (picked.size > MAX_SIZE_BYTES) {
        setError("File too large (max 10 MB).");
        return;
      }

      clearSegmentCandidates();
      setPendingFile(picked);
      setSegmentClasses("");
      setSegmentError(null);
      setSegmentStep("ask");
      setSegmentDialogOpen(true);
      setError(null);
    },
    [clearSegmentCandidates, selectedImages.length],
  );

  const onSkipSegmentation = useCallback(() => {
    if (!pendingFile) {
      return;
    }
    addSelectedImage(pendingFile);
    setSegmentDialogOpen(false);
    setPendingFile(null);
    setSegmentStep("ask");
  }, [addSelectedImage, pendingFile]);

  const onRunSegmentation = useCallback(async () => {
    if (!pendingFile) {
      return;
    }

    const classText = segmentClasses.trim();
    if (!classText) {
      setSegmentError("Object names are required.");
      return;
    }

    setSegmenting(true);
    setSegmentError(null);
    clearSegmentCandidates();

    const formData = new FormData();
    formData.append("file", pendingFile);
    formData.append("classes", classText);

    try {
      const response = await fetch("/api/segment", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setSegmentError(payload?.error ?? "Segmentation failed.");
        setSegmenting(false);
        return;
      }

      const payload = (await response.json()) as {
        annotated_image?: string | null;
        segments?: Array<{ image: string; label?: string }>;
      };

      const segments = Array.isArray(payload.segments) ? payload.segments : [];
      if (segments.length === 0) {
        setSegmentError(
          "No segments found. Try different classes or use the original image.",
        );
        setSegmenting(false);
        return;
      }

      const nextCandidates: SegmentedCandidate[] = [];
      if (
        typeof payload.annotated_image === "string" &&
        payload.annotated_image.trim()
      ) {
        const annotatedBlob = decodeBase64ToPngBlob(payload.annotated_image);
        setAnnotatedPreview(URL.createObjectURL(annotatedBlob));
      }
      for (const [index, segment] of segments.entries()) {
        const blob = decodeBase64ToPngBlob(segment.image);
        const fileName = `segment-${index + 1}.png`;
        const imageFile = new File([blob], fileName, { type: "image/png" });
        const previewUrl = URL.createObjectURL(blob);
        nextCandidates.push({
          id: `${index}`,
          label: segment.label?.trim() ? segment.label : `object ${index + 1}`,
          imageFile,
          previewUrl,
        });
      }

      setSegmentCandidates(nextCandidates);
      setSegmentStep("pick");
    } catch {
      setSegmentError("Segmentation request failed.");
    } finally {
      setSegmenting(false);
    }
  }, [clearSegmentCandidates, pendingFile, segmentClasses]);

  const onPickSegment = useCallback(
    (candidate: SegmentedCandidate) => {
      addSelectedImage(candidate.imageFile);
      setSegmentDialogOpen(false);
      setPendingFile(null);
      setSegmentStep("ask");
      setSegmentError(null);
      clearSegmentCandidates();
    },
    [addSelectedImage, clearSegmentCandidates],
  );

  const onGenerate = useCallback(async () => {
    if (selectedImages.length === 0) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

    setError(null);
    setStatus("uploading");
    setProgress(0);
    setMessage("Uploading...");
    setAssetCreated(false);

    const formData = new FormData();
    for (const image of selectedImages) {
      formData.append("files", image.file);
    }
    formData.append("resolution", String(resolution));
    formData.append("title", trimmedTitle);
    formData.append("description", description.trim());
    if (projectId) {
      formData.append("projectId", projectId);
    }

    const response = await fetch("/api/trellis/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setStatus("failed");
      setError(payload?.error ?? "Upload failed.");
      return;
    }

    const payload = (await response.json()) as { job_id: string };
    setJobId(payload.job_id);
    setStatus("processing");
    setMessage("Processing...");
  }, [description, projectId, resolution, selectedImages, title]);

  useEffect(() => {
    if (
      !generatedAssetId ||
      !downloadUrl ||
      thumbnailSaved ||
      captureSignal === 0
    ) {
      return;
    }

    if (uploadThumbnailRef.current) {
      return;
    }
    uploadThumbnailRef.current = true;

    const upload = async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const dataUrl = captureRef.current?.();
      if (!dataUrl) {
        uploadThumbnailRef.current = false;
        return;
      }

      const response = await fetch(
        `/api/assets/${generatedAssetId}/thumbnail`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dataUrl }),
        },
      );

      if (response.ok) {
        setThumbnailSaved(true);
      } else {
        uploadThumbnailRef.current = false;
      }
    };

    void upload();
  }, [captureSignal, downloadUrl, generatedAssetId, thumbnailSaved]);

  useEffect(() => {
    uploadThumbnailRef.current = false;
  }, [generatedAssetId]);

  useEffect(() => {
    if (!generatedAssetId || !thumbnailSaved) {
      return;
    }

    onAssetCreated?.(generatedAssetId);
  }, [generatedAssetId, onAssetCreated, thumbnailSaved]);

  const handleCaptureReady = useCallback((capture: () => string | null) => {
    captureRef.current = capture;
  }, []);

  const handleModelLoaded = useCallback(() => {
    setCaptureSignal(Date.now());
  }, []);

  const downloadName = useMemo(() => {
    if (!jobId) {
      return "model.glb";
    }

    return `model-${jobId.slice(0, 8)}.glb`;
  }, [jobId]);

  return (
    <div
      className={`${embedded ? "h-full min-h-0" : "h-[calc(100vh-7.5rem)] min-h-[400px]"} w-full overflow-hidden rounded-xl border lg:grid lg:grid-cols-[380px_1fr]`}
    >
      <aside className="border-b lg:border-r lg:border-b-0 p-5 sm:p-6 overflow-y-auto">
        <div className="mb-5 space-y-6">
          {!embedded ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/assets">
                <ArrowLeft className="size-4" />
                Back to assets
              </Link>
            </Button>
          ) : null}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Image to 3D
            </h1>
          </div>
        </div>

        <div className="space-y-4 mt-6">
          <div
            className="border-border rounded-lg border border-dashed p-3 transition-colors hover:border-cyan-400/60"
            onClick={() => {
              if (!isProcessing) {
                inputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (isProcessing) {
                return;
              }

              const dropped = event.dataTransfer.files[0];
              if (dropped) {
                onFilePicked(dropped);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={isProcessing}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) {
                  onFilePicked(selected);
                }
                event.currentTarget.value = "";
              }}
            />

            {selectedImages.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {selectedImages.length} / {MAX_IMAGES} images selected
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {selectedImages.map((image, index) => (
                    <div
                      key={image.id}
                      className="relative overflow-hidden rounded-md border bg-black/10 p-1"
                    >
                      <img
                        src={image.previewUrl}
                        alt={`Selected preview ${index + 1}`}
                        className="h-24 w-full rounded object-contain"
                      />
                      {!hasGenerationStarted ? (
                        <button
                          type="button"
                          className="absolute right-2 top-2 rounded border bg-black/60 px-2 text-xs text-white hover:bg-black/75"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeSelectedImage(image.id);
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="pb-4 pt-1 text-center">
                <div className="text-5xl leading-none text-muted-foreground">
                  +
                </div>
                <p className="mt-3 text-sm">Drag and drop or click to upload</p>
                <p className="text-xs text-muted-foreground mt-1">
                  JPEG, PNG, or WEBP (up to {MAX_IMAGES} images)
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Asset title
            </p>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="Enter a title"
              disabled={isProcessing}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Description (optional)
            </p>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Add context for this asset"
              disabled={isProcessing}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] tracking-widest text-muted-foreground uppercase">
              Resolution
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[512, 1024, 1536].map((size) => (
                <Button
                  key={size}
                  variant={resolution === size ? "secondary" : "outline"}
                  className={`h-12 ${resolution === size ? "border border-cyan-400 bg-cyan-950 hover:bg-cyan-900" : ""}`}
                  disabled={isProcessing}
                  onClick={() => setResolution(size)}
                >
                  {size}
                </Button>
              ))}
            </div>
          </div>

          {status !== "completed" ? (
            <Button
              onClick={onGenerate}
              disabled={selectedImages.length === 0 || isProcessing}
              className="w-full"
              size="lg"
            >
              <Sparkles className="size-4" />
              {isProcessing ? "Generating..." : "Generate"}
            </Button>
          ) : null}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          {downloadUrl ? (
            <div className="space-y-2">
              {!embedded ? (
                <Button className="w-full" asChild>
                  <Link href={`/assets/${generatedAssetId}`}>
                    View asset page <ArrowRight />
                  </Link>
                </Button>
              ) : null}
              <Button
                variant={"secondary"}
                className="w-full"
                onClick={() => {
                  const link = document.createElement("a");
                  link.href = downloadUrl;
                  link.download = downloadName;
                  link.click();
                }}
              >
                <DownloadIcon />
                Download model
              </Button>
            </div>
          ) : null}

          {assetCreated ? (
            <div className="rounded-md border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">
              {embedded
                ? "Model was saved as an asset. You can now import it from the Assets tab."
                : "Model was saved as an asset. Return to Assets to see it in the list."}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="relative min-h-[420px]">
        {downloadUrl ? (
          <TrellisModelViewer
            modelUrl={downloadUrl}
            onCaptureReady={handleCaptureReady}
            onModelLoaded={handleModelLoaded}
          />
        ) : isProcessing ? (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="w-full max-w-lg space-y-3 rounded-md border border-cyan-400/25 bg-black/30 p-4">
              <div className="h-2 overflow-hidden rounded bg-white/10">
                <div
                  className="h-full bg-cyan-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="flex items-center gap-2 text-sm text-cyan-50">
                <Spinner />
                <span>{message}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            Upload one or more images to get started
          </div>
        )}
      </section>

      <AlertDialog
        open={segmentDialogOpen}
        onOpenChange={(open) => {
          setSegmentDialogOpen(open);
          if (!open) {
            setPendingFile(null);
            setSegmentStep("ask");
            setSegmentClasses("");
            setSegmentError(null);
            setAnnotatedDialogOpen(false);
            clearSegmentCandidates();
          }
        }}
      >
        <AlertDialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {segmentStep === "ask" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Segment this image first?</AlertDialogTitle>
                <AlertDialogDescription>
                  You can isolate an object before sending it to the 3D model.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button variant="outline" onClick={onSkipSegmentation}>
                  Use original image
                </Button>
                <Button onClick={() => setSegmentStep("configure")}>
                  Segment image
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}

          {segmentStep === "configure" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>What should be segmented?</AlertDialogTitle>
                <AlertDialogDescription>
                  Enter comma separated object names.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-3">
                {pendingPreview ? (
                  <img
                    src={pendingPreview}
                    alt="Uploaded image preview"
                    className="w-full h-auto rounded-md border object-contain"
                  />
                ) : null}
                <Input
                  value={segmentClasses}
                  onChange={(event) => setSegmentClasses(event.target.value)}
                  placeholder="ex. Cup, plate, bottle"
                  disabled={segmenting}
                />
                {segmentError ? (
                  <p className="text-sm text-red-400">{segmentError}</p>
                ) : null}
              </div>
              <AlertDialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSegmentStep("ask")}
                  disabled={segmenting}
                >
                  <ArrowLeft />
                  Back
                </Button>
                <Button
                  onClick={() => void onRunSegmentation()}
                  disabled={segmenting || segmentClasses.trim().length === 0}
                >
                  {segmenting ? (
                    <>
                      <Spinner /> Segmenting...
                    </>
                  ) : (
                    "Run segmentation"
                  )}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}

          {segmentStep === "pick" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Choose a segmented object</AlertDialogTitle>
                <AlertDialogDescription>
                  Pick one segment to send to the image-to-3D model.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {annotatedPreview ? (
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Annotated image
                  </p>
                  <button
                    type="button"
                    className="w-full rounded-md border transition-colors hover:border-cyan-400/70"
                    onClick={() => setAnnotatedDialogOpen(true)}
                  >
                    <img
                      src={annotatedPreview}
                      alt="Annotated segmentation result"
                      className="h-auto w-full rounded-md object-contain"
                    />
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Click to enlarge
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                {segmentCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className="rounded-md border p-2 text-left transition-colors hover:border-cyan-400/70"
                    onClick={() => onPickSegment(candidate)}
                  >
                    <img
                      src={candidate.previewUrl}
                      alt={`Segment: ${candidate.label}`}
                      className="h-36 w-full rounded object-contain"
                    />
                    <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
                      {candidate.label}
                    </p>
                  </button>
                ))}
              </div>
              {segmentError ? (
                <p className="text-sm text-red-400">{segmentError}</p>
              ) : null}
              <AlertDialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSegmentStep("configure")}
                  disabled={segmenting}
                >
                  Try different classes
                </Button>
                <Button
                  variant="outline"
                  onClick={onSkipSegmentation}
                  disabled={segmenting}
                >
                  Use original image
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={annotatedDialogOpen}
        onOpenChange={setAnnotatedDialogOpen}
      >
        <AlertDialogContent className="w-full sm:max-w-[60vw] max-h-[85vh] h-fit overflow-hidden">
          <AlertDialogHeader>
            <AlertDialogTitle>Annotated image</AlertDialogTitle>
          </AlertDialogHeader>
          {annotatedPreview ? (
            <div className="w-full h-auto max-h-[70vh] overflow-auto rounded-md border p-2">
              <img
                src={annotatedPreview}
                alt="Annotated segmentation result (large)"
                className="h-auto w-full object-contain"
              />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
