import { createProjectAction } from "@/app/(protected)/dashboard/actions";
import ProjectStatsCard from "@/components/dashboard/project-stats-card";
import ProjectCard from "@/components/projects/project-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getProjectsForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";
import { Plus } from "lucide-react";

export default async function DashboardPage() {
  const session = await requireSession();
  const projects = await getProjectsForUser(session.user.id);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
      </div>

      <section className="mt-8 grid items-stretch gap-4 lg:grid-cols-5">
        <ProjectStatsCard
          className="lg:col-span-3"
          projects={projects.map((project) => ({
            updatedAt: project.updatedAt.toISOString(),
            assets: project._count.assets,
            visibility: project.visibility,
          }))}
        />
        <Card className="lg:col-span-2 h-fit space-y-0">
          <CardHeader>
            <CardTitle>New project</CardTitle>
          </CardHeader>
          <CardContent className="-mt-2">
            <form action={createProjectAction} className="grid gap-3">
              <Input name="name" placeholder="Project name" required />
              <Textarea name="description" placeholder="Short description" />
              <Button className="w-fit mt-3" size="sm" type="submit">
                <Plus />
                New project
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Recent projects</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.length === 0 ? (
            <p className="text-muted-foreground rounded border border-dashed p-4 text-sm sm:col-span-2 xl:col-span-3">
              No projects yet.
            </p>
        ) : (
            projects.slice(0, 6).map((project) => <ProjectCard key={project.id} project={project} />)
          )}
        </div>
      </section>
    </main>
  );
}
