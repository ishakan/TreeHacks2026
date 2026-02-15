import Link from "next/link";
import { ArrowLeft, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function TextTo3DPage() {
  return (
    <main className="mx-auto w-full max-w-4xl">
      <div className="space-y-6">
        <Button asChild variant="outline" size="sm">
          <Link href="/assets">
            <ArrowLeft className="size-4" />
            Back to assets
          </Link>
        </Button>
        <div className="rounded-xl border p-10 text-center">
          <WandSparkles className="mx-auto mb-4 size-10 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Text to 3D</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This workflow is coming soon.
          </p>
        </div>
      </div>
    </main>
  );
}
