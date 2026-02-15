import Link from "next/link";
import {
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import AssetCardThumbnail from "@/components/asset-card-thumbnail";
import {
  getAssetsForUser,
  getAssetDisplayTitle,
} from "@/lib/projects";
import { requireSession } from "@/lib/session";
import NewAssetMenu from "@/app/(protected)/assets/components/new-asset-menu";
import AssetCardMenu from "@/app/(protected)/assets/components/asset-card-menu";

function formatSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kb = sizeBytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }

  return `${(mb / 1024).toFixed(1)} GB`;
}

export default async function AssetsPage() {
  const session = await requireSession();
  const assets = await getAssetsForUser(session.user.id);

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Assets</h1>
        </div>
        <NewAssetMenu />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {assets.length === 0 ? (
          <div className="text-muted-foreground rounded border border-dashed px-8 py-32 flex flex-col items-center justify-center w-full sm:col-span-2 xl:col-span-3 gap-8">
            <Sparkles className="size-32" strokeWidth={0.5} />
            <p>No assets found</p>
          </div>
        ) : (
          assets.map((asset) => (
            <Card
              key={asset.id}
              className="h-full gap-0 py-0 transition-colors hover:border-primary/40"
            >
              <CardContent className="relative h-full p-0">
                <Link
                  href={`/assets/${asset.id}`}
                  className="flex h-full flex-col gap-3 p-4"
                >
                  <AssetCardThumbnail assetId={asset.id} fileName={asset.fileName} />
                  <div className="flex items-center justify-between gap-3">
                    <p className="line-clamp-1 font-medium">{getAssetDisplayTitle(asset)}</p>
                    <Badge variant="outline">
                      {asset.projects.length} workspace{asset.projects.length === 1 ? "" : "s"}
                    </Badge>
                  </div>

                  <div className="text-muted-foreground space-y-1 text-sm">
                    {asset.projects.length > 0 ? (
                      <p className="line-clamp-1">
                        Workspaces: {asset.projects.map((project) => project.name).join(", ")}
                      </p>
                    ) : null}
                    <p className="line-clamp-1">{asset.mimeType}</p>
                  </div>

                  <div className="text-muted-foreground mt-auto space-y-1 text-xs">
                    <p>{formatSize(asset.sizeBytes)}</p>
                    <p>Uploaded {dateFormatter.format(asset.createdAt)}</p>
                  </div>
                </Link>
                <div className="absolute right-3 bottom-3 z-10">
                  <AssetCardMenu assetId={asset.id} fileName={asset.fileName} />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
