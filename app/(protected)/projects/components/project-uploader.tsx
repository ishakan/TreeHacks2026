"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ModelThumbnailGenerator from "@/components/model-thumbnail-generator";

export default function ProjectUploader({ projectId }: { projectId: string }) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingThumbnail, setPendingThumbnail] = useState<{
    assetId: string;
    fileName: string;
    mimeType: string;
  } | null>(null);

  const onUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const form = event.currentTarget;
    const input = form.elements.namedItem("model") as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (!file) {
      setMessage("Choose a file first.");
      return;
    }

    const formData = new FormData();
    formData.append("model", file);

    setIsPending(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/assets`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessage(payload?.error ?? "Upload failed.");
        return;
      }

      const payload = (await response.json()) as {
        asset?: { id: string; fileName: string; mimeType: string };
      };

      if (!payload.asset) {
        setMessage("Upload complete.");
        window.location.assign("/assets");
        return;
      }

      setMessage("Upload complete. Generating preview...");
      setPendingThumbnail({
        assetId: payload.asset.id,
        fileName: payload.asset.fileName,
        mimeType: payload.asset.mimeType,
      });
      form.reset();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <form onSubmit={onUpload} className="mt-3 flex flex-col gap-3">
        <Input
          type="file"
          name="model"
          accept=".glb,.gltf,.obj,.stl,.step,.stp,.iges,.igs"
          className="text-sm file:mr-3 file:rounded-sm file:border-0 file:bg-cyan-400/20 file:text-cyan-100 file:px-2 file:py-1"
        />
        <Button type="submit" disabled={isPending} className="w-fit">
          {isPending ? "Uploading..." : "Upload model"}
        </Button>
        {message ? <p className="text-muted-foreground text-sm">{message}</p> : null}
      </form>
      {pendingThumbnail ? (
        <ModelThumbnailGenerator
          assetId={pendingThumbnail.assetId}
          fileName={pendingThumbnail.fileName}
          mimeType={pendingThumbnail.mimeType}
          onComplete={() => {
            window.location.assign("/assets");
          }}
        />
      ) : null}
    </>
  );
}
