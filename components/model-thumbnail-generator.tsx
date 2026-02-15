"use client";

import { useEffect, useRef, useState } from "react";
import TrellisModelViewer from "@/components/trellis-model-viewer";

export default function ModelThumbnailGenerator({
  assetId,
  fileName,
  mimeType,
  onComplete,
}: {
  assetId: string;
  fileName: string;
  mimeType: string;
  onComplete: (success: boolean) => void;
}) {
  const captureRef = useRef<(() => string | null) | null>(null);
  const [captureSignal, setCaptureSignal] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (!captureSignal || isUploading) {
      return;
    }

    setIsUploading(true);

    const upload = async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const dataUrl = captureRef.current?.();

      if (!dataUrl) {
        onComplete(false);
        return;
      }

      try {
        const response = await fetch(`/api/assets/${assetId}/thumbnail`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dataUrl }),
        });

        onComplete(response.ok);
      } catch {
        onComplete(false);
      }
    };

    void upload();
  }, [assetId, captureSignal, isUploading, onComplete]);

  return (
    <div className="pointer-events-none fixed -left-[9999px] top-0 h-[420px] w-[420px] opacity-0">
      <TrellisModelViewer
        modelUrl={`/api/assets/${assetId}/file`}
        modelFileName={fileName}
        modelMimeType={mimeType}
        showLightingControls={false}
        onCaptureReady={(capture) => {
          captureRef.current = capture;
        }}
        onModelLoaded={() => {
          setCaptureSignal(Date.now());
        }}
      />
    </div>
  );
}
