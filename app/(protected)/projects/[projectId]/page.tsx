import Link from "next/link";
import { notFound } from "next/navigation";
import ProjectSettingsForm from "@/app/(protected)/projects/[projectId]/project-settings-form";
import ProjectScenePreview from "@/app/(protected)/projects/[projectId]/project-scene-preview";
import AssetCardThumbnail from "@/components/asset-card-thumbnail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAssetDisplayTitle, getProjectForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";

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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await requireSession();
  const project = await getProjectForUser(projectId, session.user.id);

  if (!project) {
    notFound();
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="space-y-6">
        <Button asChild variant="outline" size="sm">
          <Link href="/projects">
            <ArrowLeft />
            Back to projects
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold">{project.name}</h1>
          <Button asChild size="sm">
            <Link href={`/studio/${project.id}`}>
              Open in studio <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Project settings</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectSettingsForm
            project={{
              id: project.id,
              name: project.name,
              description: project.description,
              visibility: project.visibility,
            }}
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Scene preview</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectScenePreview projectId={project.id} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Project assets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {project.assets.length === 0 ? (
              <div className="text-muted-foreground rounded border border-dashed px-8 py-20 flex flex-col items-center justify-center w-full sm:col-span-2 xl:col-span-3 gap-6">
                <Sparkles className="size-16" strokeWidth={0.75} />
                <p>No assets in this project yet.</p>
              </div>
            ) : (
              project.assets.map((asset) => (
                <Card
                  key={asset.id}
                  className="h-full gap-0 py-0 transition-colors hover:border-primary/40"
                >
                  <CardContent className="h-full p-0">
                    <Link
                      href={`/assets/${asset.id}`}
                      className="flex h-full flex-col gap-3 p-4"
                    >
                      <AssetCardThumbnail
                        assetId={asset.id}
                        fileName={asset.fileName}
                      />
                      <div className="flex items-center justify-between gap-3">
                        <p className="line-clamp-1 font-medium">
                          {getAssetDisplayTitle(asset)}
                        </p>
                      </div>

                      <div className="text-muted-foreground space-y-1 text-sm">
                        <p className="line-clamp-1">{asset.mimeType}</p>
                      </div>

                      <div className="text-muted-foreground mt-auto space-y-1 text-xs">
                        <p>{formatSize(asset.sizeBytes)}</p>
                        <p>Uploaded {dateFormatter.format(asset.createdAt)}</p>
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
