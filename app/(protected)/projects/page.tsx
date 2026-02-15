import ProjectCard from "@/components/projects/project-card";
import NewProjectButton from "@/app/(protected)/projects/components/new-project-button";
import { getProjectsForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";

export default async function ProjectsPage() {
  const session = await requireSession();
  const projects = await getProjectsForUser(session.user.id);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Projects</h1>
        <NewProjectButton />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.length === 0 ? (
          <p className="text-muted-foreground rounded border border-dashed p-4 text-sm sm:col-span-2 xl:col-span-3">
            No projects yet. Create one from dashboard.
          </p>
        ) : (
          projects.map((project) => <ProjectCard key={project.id} project={project} />)
        )}
      </div>
    </main>
  );
}
