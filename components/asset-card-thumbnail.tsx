"use client";

import { useMemo, useState } from "react";
import { Box } from "lucide-react";

export default function AssetCardThumbnail({
  assetId,
  fileName,
}: {
  assetId: string;
  fileName: string;
}) {
  const [hasThumbnail, setHasThumbnail] = useState(true);

  const thumbnailSrc = useMemo(
    () => `/api/assets/${assetId}/thumbnail?v=${encodeURIComponent(assetId)}`,
    [assetId],
  );

  if (!hasThumbnail) {
    return (
      <div className="bg-muted/25 flex h-40 w-full items-center justify-center rounded-md border">
        <Box className="text-muted-foreground size-8" />
      </div>
    );
  }

  return (
    <img
      src={thumbnailSrc}
      alt={`${fileName} preview`}
      className="h-40 w-full rounded-t-md border object-cover"
      onError={() => setHasThumbnail(false)}
    />
  );
}
