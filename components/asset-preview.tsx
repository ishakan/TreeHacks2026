"use client";

import TrellisModelViewer from "@/components/trellis-model-viewer";

function isModel(mimeType: string) {
  return mimeType.startsWith("model/");
}

function isImage(mimeType: string) {
  return mimeType.startsWith("image/");
}

function isVideo(mimeType: string) {
  return mimeType.startsWith("video/");
}

function isAudio(mimeType: string) {
  return mimeType.startsWith("audio/");
}

export default function AssetPreview({
  src,
  mimeType,
  fileName,
}: {
  src: string;
  mimeType: string;
  fileName: string;
}) {
  if (isModel(mimeType)) {
    return (
      <div className="h-[560px] w-full rounded-md overflow-hidden border bg-[#06090f]">
        <TrellisModelViewer
          modelUrl={src}
          modelMimeType={mimeType}
          modelFileName={fileName}
        />
      </div>
    );
  }

  if (isImage(mimeType)) {
    return (
      <div className="w-full rounded-md overflow-hidden border bg-muted/20 p-3">
        <img src={src} alt={fileName} className="max-h-[560px] w-full object-contain" />
      </div>
    );
  }

  if (isVideo(mimeType)) {
    return (
      <video className="w-full rounded-md border" controls src={src}>
        Your browser does not support embedded videos.
      </video>
    );
  }

  if (isAudio(mimeType)) {
    return <audio className="w-full" controls src={src} />;
  }

  return (
    <div className="rounded-md border p-4 text-sm text-muted-foreground">
      Preview not available for this file type.
    </div>
  );
}
