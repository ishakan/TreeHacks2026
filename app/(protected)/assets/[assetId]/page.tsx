import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import AssetPreview from "@/components/asset-preview";
import { getAssetDisplayTitle, getAssetForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";
import { updateAssetDetailsAction } from "@/app/(protected)/assets/[assetId]/actions";
import { ArrowLeft } from "lucide-react";

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

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const session = await requireSession();
  const asset = await getAssetForUser(assetId, session.user.id);

  if (!asset) {
    notFound();
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-4xl">
      <div className="space-y-6">
        <Button asChild variant="outline" size="sm">
          <Link href="/assets">
            <ArrowLeft />
            Back to assets
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-semibold">
            {getAssetDisplayTitle(asset)}
          </h1>
        </div>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <AssetPreview
            src={`/api/assets/${asset.id}/file`}
            mimeType={asset.mimeType}
            fileName={asset.fileName}
          />
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateAssetDetailsAction} className="grid gap-3">
            <input type="hidden" name="assetId" value={asset.id} />
            <div className="grid gap-2">
              <Label htmlFor="asset-title">Title</Label>
              <Input
                id="asset-title"
                name="title"
                defaultValue={getAssetDisplayTitle(asset)}
                maxLength={120}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="asset-description">Description</Label>
              <Textarea
                id="asset-description"
                name="description"
                defaultValue={asset.description ?? ""}
                maxLength={2000}
                placeholder="Optional"
              />
            </div>
            <Button className="w-fit" type="submit">
              Save details
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{asset.mimeType}</Badge>
            <span className="text-muted-foreground">
              {formatSize(asset.sizeBytes)}
            </span>
          </div>
          <p className="text-muted-foreground">File name: {asset.fileName}</p>
          <p>Uploaded {dateFormatter.format(asset.createdAt)}</p>
          <p className="break-all text-muted-foreground">
            Storage: {asset.storagePath}
          </p>
          <p>
            Workspaces:{" "}
            {asset.projects.length > 0 ? (
              asset.projects.map((project, index) => (
                <span key={project.id}>
                  {index > 0 ? ", " : null}
                  <Link href={`/projects/${project.id}`} className="underline">
                    {project.name}
                  </Link>
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">0</span>
            )}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
