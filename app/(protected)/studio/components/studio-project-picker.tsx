"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { ArrowRight } from "lucide-react";

type StudioProject = {
  id: string;
  name: string;
};

type StudioProjectPickerProps = {
  projects: StudioProject[];
};

export default function StudioProjectPicker({
  projects,
}: StudioProjectPickerProps) {
  const router = useRouter();
  const [selectedProject, setSelectedProject] = useState<StudioProject | null>(
    null,
  );

  const selectedProjectName = useMemo(
    () => selectedProject?.name ?? "",
    [selectedProject],
  );

  return (
    <div className="space-y-4">
      <Combobox
        items={projects}
        value={selectedProject}
        onValueChange={setSelectedProject}
        itemToStringLabel={(item) => (item ? item.name : "")}
        itemToStringValue={(item) => (item ? item.id : "")}
      >
        <ComboboxInput
          className="w-full"
          placeholder="Choose a project..."
          aria-label="Choose a project"
        />
        <ComboboxContent>
          <ComboboxEmpty>No projects found.</ComboboxEmpty>
          <ComboboxList>
            {(project: StudioProject) => (
              <ComboboxItem key={project.id} value={project}>
                {project.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      <Button
        className="mt-2"
        disabled={!selectedProject}
        onClick={() => {
          if (!selectedProject) {
            return;
          }
          router.push(`/studio/${selectedProject.id}`);
        }}
      >
        {selectedProjectName
          ? `Open ${selectedProjectName}`
          : "Open selected project"}
        <ArrowRight />
      </Button>
    </div>
  );
}
