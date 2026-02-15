import StudioProjectPicker from "@/app/(protected)/studio/components/studio-project-picker";
import { getProjectsForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";

export default async function StudioPage() {
  const session = await requireSession();
  const projects = await getProjectsForUser(session.user.id);

  return (
    <main className="mx-auto w-full max-w-6xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Studio</h1>
        <p className="text-muted-foreground text-sm">
          Choose a project from the combobox to open its scene.
        </p>
      </div>
      <div className="mt-6 max-w-xl">
        <StudioProjectPicker
          projects={projects.map((project) => ({
            id: project.id,
            name: project.name,
          }))}
        />
      </div>
      {projects.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm">
          No projects found. Create one from Projects first.
        </p>
      ) : null}
    </main>
  );
}
