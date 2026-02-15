import Link from "next/link";
import { notFound } from "next/navigation";
import ProjectSettingsForm from "@/app/(protected)/projects/[projectId]/project-settings-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjectForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";
import { ArrowLeft } from "lucide-react";

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

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="space-y-6">
        <Button asChild variant="outline" size="sm">
          <Link href="/projects">
            <ArrowLeft />
            Back to projects
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-semibold">{project.name}</h1>
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
    </main>
  );
}
