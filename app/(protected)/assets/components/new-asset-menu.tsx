"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Box, ChevronDown, ImageUp, Plus, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import ModelThumbnailGenerator from "@/components/model-thumbnail-generator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MODEL_ACCEPT_TYPES = ".glb,.gltf,.obj,.stl,.step,.stp,.iges,.igs";

export default function NewAssetMenu() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [pendingThumbnail, setPendingThumbnail] = useState<{
    assetId: string;
    fileName: string;
    mimeType: string;
  } | null>(null);

  const onUploadSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploadMessage(null);
    setIsUploading(true);

    const formData = new FormData();
    formData.append("model", file);

    try {
      const response = await fetch("/api/assets", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setUploadMessage(payload?.error ?? "Upload failed.");
        return;
      }

      const payload = (await response.json()) as {
        asset?: { id: string; fileName: string; mimeType: string };
      };

      if (!payload.asset) {
        setUploadMessage("Upload complete.");
        window.location.assign("/assets");
        return;
      }

      setUploadMessage("Upload complete. Generating preview...");
      setPendingThumbnail({
        assetId: payload.asset.id,
        fileName: payload.asset.fileName,
        mimeType: payload.asset.mimeType,
      });
    } catch {
      setUploadMessage("Upload failed.");
    } finally {
      event.target.value = "";
      setIsUploading(false);
    }
  };

  const onUploadClick = () => {
    setUploadMessage(null);
    fileInputRef.current?.click();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="size-4" />
            New Asset
            <Separator className="h-full ml-1.5 mr-0.5" orientation="vertical" />
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-88 p-1 pb-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={MODEL_ACCEPT_TYPES}
            className="hidden"
            onChange={onUploadSelect}
          />

          <DropdownMenuItem
            className="cursor-pointer pr-1 py-0"
            onSelect={(event) => {
              event.preventDefault();
              onUploadClick();
            }}
          >
            <div className="flex w-full items-start">
              <div className="bg-muted/60 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg mt-2">
                <Box className="size-5" />
              </div>
              <div className="flex flex-col items-start gap-0.5 px-3 py-2">
                <span className="text-sm font-medium">
                  {isUploading ? "Uploading 3D file..." : "Upload 3D file"}
                </span>
                <span className="text-muted-foreground text-xs">
                  Upload an existing 3D model asset.
                </span>
                {uploadMessage ? (
                  <span className="text-muted-foreground text-xs">{uploadMessage}</span>
                ) : null}
              </div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem asChild className="cursor-pointer pr-1 py-0">
            <Link href="/generate/image-to-3d" className="w-full">
              <div className="flex w-full items-start">
                <div className="bg-muted/60 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg mt-2">
                  <ImageUp className="size-5" />
                </div>
                <div className="flex flex-col items-start gap-0.5 px-3 py-2">
                  <span className="text-sm font-medium">
                    Image to 3D
                    <span className="bg-cyan-300 text-slate-950 px-1.5 py-0.5 ml-2 rounded text-xs">
                      AI
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Turn images into 3D models using AI.
                  </span>
                </div>
              </div>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem className="cursor-pointer pr-1 py-0">
            <div className="flex w-full items-start">
              <div className="bg-muted/60 text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg mt-2">
                <WandSparkles className="size-5" />
              </div>
              <div className="flex flex-col items-start gap-0.5 px-3 py-2">
                <span className="text-sm font-medium">
                  Text to 3D
                  <span className="bg-cyan-300 text-slate-950 px-1.5 py-0.5 ml-2 rounded text-xs">
                    AI
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  Describe what you want to generate a 3D model from text.
                </span>
              </div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {pendingThumbnail ? (
        <ModelThumbnailGenerator
          assetId={pendingThumbnail.assetId}
          fileName={pendingThumbnail.fileName}
          mimeType={pendingThumbnail.mimeType}
          onComplete={() => {
            window.location.assign("/assets");
          }}
        />
      ) : null}
    </>
  );
}
