import { notFound } from "next/navigation";
import CadStudioWorkbench from "@/app/(protected)/studio/components/cad-studio-workbench";
import { getProjectForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";

export default async function ProjectStudioPage({
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
    <main className="-m-4 w-[calc(100%+2rem)] lg:-m-6 lg:-mt-8 lg:w-[calc(100%+3rem)] lg:h-[calc(100svh-3.5rem)]">
      <CadStudioWorkbench projectId={project.id} projectName={project.name} />
    </main>
  );
}
