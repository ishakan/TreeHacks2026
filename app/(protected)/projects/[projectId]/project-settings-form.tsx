"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateProjectSettingsAction } from "@/app/(protected)/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type ProjectSettingsFormProps = {
  project: {
    id: string;
    name: string;
    description: string | null;
    visibility: "PRIVATE" | "UNLISTED" | "PUBLIC";
  };
};

export default function ProjectSettingsForm({ project }: ProjectSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState(project.visibility);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const formData = new FormData(form);
        formData.set("visibility", visibility);

        startTransition(async () => {
          await updateProjectSettingsAction(formData);
          router.refresh();
        });
      }}
      className="grid gap-3"
    >
      <input type="hidden" name="projectId" value={project.id} />
      <div className="grid gap-2">
        <Label htmlFor="project-name">Name</Label>
        <Input id="project-name" name="name" defaultValue={project.name} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="project-description">Description</Label>
        <Textarea
          id="project-description"
          name="description"
          defaultValue={project.description ?? ""}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="project-visibility">Visibility</Label>
        <Select value={visibility} onValueChange={(value) => setVisibility(value as typeof visibility)}>
          <SelectTrigger id="project-visibility" className="w-fit min-w-36">
            <SelectValue placeholder="Visibility" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PRIVATE">Private</SelectItem>
            <SelectItem value="UNLISTED">Unlisted</SelectItem>
            <SelectItem value="PUBLIC">Public</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button className="mt-4 w-fit" type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save settings"}
      </Button>
    </form>
  );
}
