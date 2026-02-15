import Link from "next/link";
import ProjectCardMenu from "@/components/projects/project-card-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription } from "@/components/ui/card";

type ProjectCardProps = {
  project: {
    id: string;
    name: string;
    description: string | null;
    visibility: "PRIVATE" | "UNLISTED" | "PUBLIC";
    updatedAt: Date;
    _count: {
      assets: number;
    };
  };
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatVisibility(visibility: ProjectCardProps["project"]["visibility"]) {
  return visibility.charAt(0) + visibility.slice(1).toLowerCase();
}

export default function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Card className="h-full gap-0 py-0 transition-colors hover:border-primary/40">
      <CardContent className="flex h-full flex-col p-0">
        <Link href={`/projects/${project.id}`} className="flex flex-1 flex-col gap-3 p-4 pb-2">
          <div className="flex items-center justify-between gap-3">
            <p className="line-clamp-1 font-medium">{project.name}</p>
            <Badge variant="outline" className="border-cyan-400 bg-cyan-950">
              {formatVisibility(project.visibility)}
            </Badge>
          </div>
          <CardDescription className="line-clamp-3 min-h-12">
            {project.description || "No description provided"}
          </CardDescription>
        </Link>
        <div className="mt-auto flex items-end justify-between gap-2 p-4 pt-0">
          <Link href={`/projects/${project.id}`} className="text-muted-foreground space-y-1 text-xs">
            <p>
              {project._count.assets} {project._count.assets === 1 ? "asset" : "assets"}
            </p>
            <p>Updated {dateFormatter.format(project.updatedAt)}</p>
          </Link>
          <ProjectCardMenu projectId={project.id} projectName={project.name} />
        </div>
      </CardContent>
    </Card>
  );
}
