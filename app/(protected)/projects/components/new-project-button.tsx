"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

type ProjectVisibility = "PRIVATE" | "UNLISTED" | "PUBLIC";

export default function NewProjectButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<ProjectVisibility>("PRIVATE");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsCreating(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          description,
          visibility,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(payload?.error ?? "Failed to create project.");
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        project?: { id?: string };
      } | null;
      const projectId = payload?.project?.id;

      setIsOpen(false);
      setVisibility("PRIVATE");
      form.reset();
      if (projectId) {
        router.push(`/projects/${projectId}`);
      } else {
        router.refresh();
      }
    } catch {
      setErrorMessage("Failed to create project.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>
        <Plus className="size-4" />
        New project
      </Button>

      <AlertDialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) {
            setVisibility("PRIVATE");
            setErrorMessage(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New project</AlertDialogTitle>
          </AlertDialogHeader>
          <form className="grid gap-3" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="new-project-name">Name</Label>
              <Input id="new-project-name" name="name" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-project-description">Description</Label>
              <Textarea id="new-project-description" name="description" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-project-visibility">Visibility</Label>
              <Select
                value={visibility}
                onValueChange={(value) =>
                  setVisibility(value as ProjectVisibility)
                }
              >
                <SelectTrigger
                  id="new-project-visibility"
                  className="w-fit min-w-36"
                >
                  <SelectValue placeholder="Visibility" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                  <SelectItem value="UNLISTED">Unlisted</SelectItem>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {errorMessage ? (
              <p className="text-destructive text-sm">{errorMessage}</p>
            ) : null}
            <AlertDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? "Creating..." : "Create project"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
