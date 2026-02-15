"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import TrellisModelViewer from "@/components/trellis-model-viewer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type AssetEditorProps = {
  assetId: string;
  fileName: string;
  mimeType: string;
};

type EditResponse = {
  success?: boolean;
  message?: string;
  glbFilename?: string;
  asset?: {
    id: string;
    fileName: string;
    mimeType: string;
  };
  error?: string;
};

export default function AssetEditor({
  assetId,
  fileName,
  mimeType,
}: AssetEditorProps) {
  const captureRef = useRef<(() => string | null) | null>(null);
  const isSavingThumbnailRef = useRef(false);
  const [input, setInput] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Describe the edit you want to apply. I will update the model and save each result as a new asset.",
    },
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [currentAssetId, setCurrentAssetId] = useState(assetId);
  const [currentFileName, setCurrentFileName] = useState(fileName);
  const [currentMimeType, setCurrentMimeType] = useState(mimeType);
  const [currentGlbFilename, setCurrentGlbFilename] = useState<string | null>(
    null,
  );
  const [latestCreatedAssetId, setLatestCreatedAssetId] = useState<
    string | null
  >(null);
  const [pendingThumbnailAssetId, setPendingThumbnailAssetId] = useState<
    string | null
  >(null);
  const [messageCount, setMessageCount] = useState(0);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const modelUrl = useMemo(
    () =>
      `/api/assets/${currentAssetId}/file?v=${encodeURIComponent(String(messageCount))}`,
    [currentAssetId, messageCount],
  );

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isEditing]);

  const appendMessage = (role: ChatMessage["role"], text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${role}-${Date.now()}-${prev.length}`,
        role,
        text,
      },
    ]);
  };

  const applyEdit = async () => {
    const instruction = input.trim();
    if (!instruction || isEditing) {
      return;
    }

    setIsEditing(true);
    setError(null);
    appendMessage("user", instruction);

    try {
      const response = await fetch(`/api/assets/${assetId}/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instruction,
          history,
          glbFilename: currentGlbFilename,
        }),
      });

      const payload = (await response
        .json()
        .catch(() => null)) as EditResponse | null;

      if (!response.ok) {
        const message = payload?.error || "Failed to apply edit.";
        throw new Error(message);
      }

      if (!payload?.asset?.id || !payload.asset.fileName) {
        throw new Error("Edit completed but no asset was returned.");
      }

      setCurrentAssetId(payload.asset.id);
      setCurrentFileName(payload.asset.fileName);
      setCurrentMimeType(payload.asset.mimeType || "model/gltf-binary");
      setCurrentGlbFilename(payload.glbFilename || null);
      setLatestCreatedAssetId(payload.asset.id);
      setPendingThumbnailAssetId(payload.asset.id);
      setHistory((prev) => [...prev, instruction]);
      setMessageCount((prev) => prev + 1);
      appendMessage("assistant", payload.message || "Edit applied.");
      setInput("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Edit failed.";
      setError(message);
      appendMessage("assistant", `Edit failed: ${message}`);
    } finally {
      setIsEditing(false);
    }
  };

  const saveThumbnailForCurrentAsset = async () => {
    if (
      !pendingThumbnailAssetId ||
      pendingThumbnailAssetId !== currentAssetId ||
      isSavingThumbnailRef.current
    ) {
      return;
    }

    isSavingThumbnailRef.current = true;
    setPendingThumbnailAssetId(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const dataUrl = captureRef.current?.();
      if (!dataUrl) {
        return;
      }

      await fetch(`/api/assets/${currentAssetId}/thumbnail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dataUrl }),
      });
    } finally {
      isSavingThumbnailRef.current = false;
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
      <div className="rounded-md overflow-hidden border bg-[#06090f] h-[520px]">
        <TrellisModelViewer
          modelUrl={modelUrl}
          modelMimeType={currentMimeType}
          modelFileName={currentFileName}
          onCaptureReady={(capture) => {
            captureRef.current = capture;
          }}
          onModelLoaded={() => {
            void saveThumbnailForCurrentAsset();
          }}
        />
      </div>

      <div className="rounded-md border p-4 space-y-3">
        <div className="space-y-1 mb-4">
          <h3 className="font-medium">Editor chat</h3>
        </div>

        <div className="h-[300px] overflow-y-auto rounded-lg border bg-muted/20 p-3 space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[95%] rounded-lg px-3 py-3 text-sm ${
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-background border"
              }`}
            >
              <p className="text-sm">{message.text}</p>
            </div>
          ))}
          <div ref={chatBottomRef} />
        </div>

        <div className="space-y-2">
          <Textarea
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Example: Make the legs 20% longer"
            disabled={isEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void applyEdit();
              }
            }}
          />
          <Button
            className="w-full"
            size="lg"
            type="button"
            onClick={() => void applyEdit()}
            disabled={isEditing || input.trim().length === 0}
          >
            {isEditing ? <Spinner /> : <Send className="size-4" />}
            {isEditing ? "Applying edit..." : "Apply edit"}
          </Button>
        </div>

        {latestCreatedAssetId ? (
          <p className="text-xs text-muted-foreground">
            Latest edited asset:{" "}
            <Link
              href={`/assets/${latestCreatedAssetId}`}
              className="underline"
            >
              open asset
            </Link>
          </p>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
