"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, ArrowRight, Send } from "lucide-react";
import TrellisModelViewer from "@/components/trellis-model-viewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type BlueprintSessionState = {
  sessionId: string;
  html: string;
  scadCode: string;
};

type BlueprintSseEvent = {
  type?: string;
  sessionId?: string;
  html?: string;
  scadCode?: string;
  text?: string;
  error?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
};

function renderInlineChatText(content: string) {
  const parts = content.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`chat-part-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("__") && part.endsWith("__") && part.length > 4) {
      return <u key={`chat-part-${index}`}>{part.slice(2, -2)}</u>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={`chat-part-${index}`}>{part.slice(1, -1)}</em>;
    }
    return <span key={`chat-part-${index}`}>{part}</span>;
  });
}

function renderChatText(content: string) {
  const lines = content.split("\n");
  const nodes: ReactNode[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const h3Match = line.match(/^###\s+(.+)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const h1Match = line.match(/^#\s+(.+)/);
    const bulletMatch = line.match(/^[-*]\s+(.+)/);

    if (h3Match) {
      nodes.push(
        <h4 key={`chat-h3-${lineIndex}`} className="text-sm font-semibold">
          {renderInlineChatText(h3Match[1])}
        </h4>,
      );
      lineIndex += 1;
      continue;
    }

    if (h2Match) {
      nodes.push(
        <h3 key={`chat-h2-${lineIndex}`} className="text-base font-semibold">
          {renderInlineChatText(h2Match[1])}
        </h3>,
      );
      lineIndex += 1;
      continue;
    }

    if (h1Match) {
      nodes.push(
        <h2 key={`chat-h1-${lineIndex}`} className="text-lg font-semibold">
          {renderInlineChatText(h1Match[1])}
        </h2>,
      );
      lineIndex += 1;
      continue;
    }

    if (bulletMatch) {
      const items: string[] = [];
      while (lineIndex < lines.length) {
        const nextMatch = lines[lineIndex].match(/^[-*]\s+(.+)/);
        if (!nextMatch) {
          break;
        }
        items.push(nextMatch[1]);
        lineIndex += 1;
      }
      nodes.push(
        <ul key={`chat-list-${lineIndex}`} className="list-disc pl-5 space-y-1">
          {items.map((item, itemIndex) => (
            <li key={`chat-list-item-${lineIndex}-${itemIndex}`}>
              {renderInlineChatText(item)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (line.trim().length === 0) {
      nodes.push(<div key={`chat-space-${lineIndex}`} className="h-2" />);
    } else {
      nodes.push(
        <p key={`chat-line-${lineIndex}`}>{renderInlineChatText(line)}</p>,
      );
    }
    lineIndex += 1;
  }

  return nodes;
}

async function streamBlueprintSse(
  endpoint: string,
  payload: Record<string, unknown>,
  onEvent: (event: BlueprintSseEvent) => void,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as {
      error?: string;
      detail?: string;
    } | null;
    throw new Error(
      errorPayload?.error ?? errorPayload?.detail ?? "Request failed.",
    );
  }

  if (!response.body) {
    throw new Error("Missing SSE response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emitEvents = (raw: string) => {
    const dataLines = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) {
      return;
    }

    const data = dataLines.join("\n");
    try {
      onEvent(JSON.parse(data) as BlueprintSseEvent);
    } catch {
      return;
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, "");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      emitEvents(rawEvent);
    }
  }

  if (buffer.trim()) {
    emitEvents(buffer.trim());
  }
}

export default function TextTo3DWorkbench({
  embedded = false,
  onAssetCreated,
  projectId,
}: {
  embedded?: boolean;
  onAssetCreated?: (assetId: string) => void;
  projectId?: string;
}) {
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Describe the object you want to create. I will generate a blueprint, refine it with you, then produce a 3D model.",
    },
  ]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInput, setSessionInput] = useState("");
  const [blueprintHtml, setBlueprintHtml] = useState("");
  const [scadCode, setScadCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<
    null | "generate" | "refine-blueprint" | "confirm" | "refine-code"
  >(null);
  const [modelPreviewUrl, setModelPreviewUrl] = useState<string | null>(null);
  const [modelPreviewName, setModelPreviewName] = useState(
    "model-preview.stl",
  );
  const [modelPreviewMimeType, setModelPreviewMimeType] =
    useState("model/stl");
  const [modelPreviewLoading, setModelPreviewLoading] = useState(false);
  const [modelPreviewError, setModelPreviewError] = useState<string | null>(
    null,
  );
  const [assetSaveError, setAssetSaveError] = useState<string | null>(null);
  const [assetCreated, setAssetCreated] = useState(false);
  const [generatedAssetId, setGeneratedAssetId] = useState<string | null>(null);
  const [captureSignal, setCaptureSignal] = useState(0);
  const [thumbnailSaved, setThumbnailSaved] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const messageCounterRef = useRef(0);
  const modelPreviewUrlRef = useRef<string | null>(null);
  const captureRef = useRef<(() => string | null) | null>(null);
  const uploadThumbnailRef = useRef(false);

  const hasBlueprint = blueprintHtml.trim().length > 0;
  const hasCode = scadCode.trim().length > 0;

  const conversationStage = !sessionId
    ? "Describe object"
    : !hasCode
      ? "Refine blueprint"
      : "Refine OpenSCAD";

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activeAction]);

  useEffect(() => {
    modelPreviewUrlRef.current = modelPreviewUrl;
  }, [modelPreviewUrl]);

  const saveRenderedModelAsAsset = useCallback(
    async (blob: Blob, mimeType: string, fileName: string) => {
      setAssetSaveError(null);
      setAssetCreated(false);
      setGeneratedAssetId(null);
      setThumbnailSaved(false);
      uploadThumbnailRef.current = false;

      const modelFile = new File([blob], fileName, { type: mimeType });
      const formData = new FormData();
      formData.append("model", modelFile);

      const response = await fetch(
        projectId ? `/api/projects/${projectId}/assets` : "/api/assets",
        {
        method: "POST",
        body: formData,
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Failed to save generated asset.");
      }

      const payload = (await response.json()) as {
        asset?: { id: string };
      };
      if (!payload.asset?.id) {
        throw new Error("Generated asset was saved but no ID was returned.");
      }

      setGeneratedAssetId(payload.asset.id);
      setAssetCreated(true);
    },
    [projectId],
  );

  useEffect(() => {
    return () => {
      if (modelPreviewUrlRef.current) {
        URL.revokeObjectURL(modelPreviewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const sid = sessionId?.trim();
    if (!sid || !hasCode) {
      const previousUrl = modelPreviewUrlRef.current;
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
        modelPreviewUrlRef.current = null;
      }
      setModelPreviewUrl(null);
      setModelPreviewLoading(false);
      setModelPreviewError(null);
      return;
    }

    const controller = new AbortController();
    setModelPreviewLoading(true);
    setModelPreviewError(null);

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/blueprint/render", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sid, scadCode }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorPayload = (await response.json().catch(() => null)) as {
              error?: string;
              detail?: string;
            } | null;
            throw new Error(
              errorPayload?.error ??
                errorPayload?.detail ??
                "Failed to render OpenSCAD preview.",
            );
          }

          const blob = await response.blob();
          if (blob.size === 0) {
            throw new Error("Render returned an empty model.");
          }

          const contentType = response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim();
          const mimeType = contentType || blob.type || "model/stl";
          const ext = mimeType.includes("gltf")
            ? "glb"
            : mimeType.includes("obj")
              ? "obj"
              : "stl";

          const objectUrl = URL.createObjectURL(blob);
          const previousUrl = modelPreviewUrlRef.current;
          modelPreviewUrlRef.current = objectUrl;
          setModelPreviewUrl(objectUrl);
          setModelPreviewMimeType(mimeType);
          setModelPreviewName(`model-preview.${ext}`);

          if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
          }

          await saveRenderedModelAsAsset(
            blob,
            mimeType,
            `model-${sid.slice(0, 8)}.${ext}`,
          );
        } catch (renderError) {
          if (controller.signal.aborted) {
            return;
          }
          const message =
            renderError instanceof Error
              ? renderError.message
              : "Failed to render OpenSCAD preview.";
          if (message.toLowerCase().includes("asset")) {
            setAssetSaveError(message);
          } else {
            setModelPreviewError(message);
          }
        } finally {
          if (!controller.signal.aborted) {
            setModelPreviewLoading(false);
          }
        }
      })();
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [hasCode, saveRenderedModelAsAsset, scadCode, sessionId]);

  useEffect(() => {
    if (
      !generatedAssetId ||
      !modelPreviewUrl ||
      thumbnailSaved ||
      captureSignal === 0
    ) {
      return;
    }

    if (uploadThumbnailRef.current) {
      return;
    }
    uploadThumbnailRef.current = true;

    const upload = async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const dataUrl = captureRef.current?.();
      if (!dataUrl) {
        uploadThumbnailRef.current = false;
        return;
      }

      const response = await fetch(`/api/assets/${generatedAssetId}/thumbnail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dataUrl }),
      });

      if (response.ok) {
        setThumbnailSaved(true);
      } else {
        uploadThumbnailRef.current = false;
      }
    };

    void upload();
  }, [captureSignal, generatedAssetId, modelPreviewUrl, thumbnailSaved]);

  useEffect(() => {
    uploadThumbnailRef.current = false;
  }, [generatedAssetId]);

  useEffect(() => {
    if (!generatedAssetId || !thumbnailSaved) {
      return;
    }
    onAssetCreated?.(generatedAssetId);
  }, [generatedAssetId, onAssetCreated, thumbnailSaved]);

  const nextMessageId = useCallback(() => {
    messageCounterRef.current += 1;
    return `message-${messageCounterRef.current}`;
  }, []);

  const applySessionState = useCallback(
    (payload: Partial<BlueprintSessionState>) => {
      if (payload.sessionId) {
        setSessionId(payload.sessionId);
        setSessionInput(payload.sessionId);
      }
      if (typeof payload.html === "string") {
        setBlueprintHtml(payload.html);
      }
      if (typeof payload.scadCode === "string") {
        setScadCode(payload.scadCode);
      }
    },
    [],
  );

  const runBlueprintAction = useCallback(
    async (
      userMessage: string | null,
      action:
        | {
            type: "generate";
            endpoint: "/api/blueprint/generate";
            payload: { description: string };
          }
        | {
            type: "refine-blueprint";
            endpoint: "/api/blueprint/refine";
            payload: { sessionId: string; feedback: string };
          }
        | {
            type: "confirm";
            endpoint: "/api/blueprint/confirm";
            payload: { sessionId: string };
          }
        | {
            type: "refine-code";
            endpoint: "/api/blueprint/refine-code";
            payload: { sessionId: string; feedback: string };
          },
    ) => {
      setError(null);
      setActiveAction(action.type);
      const assistantMessageId = nextMessageId();

      if (userMessage?.trim()) {
        setChatMessages((current) => [
          ...current,
          {
            id: nextMessageId(),
            role: "user",
            content: userMessage.trim(),
          },
        ]);
      }
      setChatMessages((current) => [
        ...current,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          streaming: true,
        },
      ]);

      try {
        let streamedText = "";
        await streamBlueprintSse(action.endpoint, action.payload, (event) => {
          if (event.error) {
            setError(event.error);
          }
          if (event.type === "text_delta" && typeof event.text === "string") {
            streamedText += event.text;
            setChatMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: `${message.content}${event.text}` }
                  : message,
              ),
            );
          }
          if (event.type === "blueprint_start" && event.sessionId) {
            setSessionId(event.sessionId);
          }
          if (event.type === "blueprint_complete") {
            applySessionState({
              sessionId: event.sessionId,
              html: event.html,
            });
          }
          if (event.type === "code_complete") {
            applySessionState({
              sessionId: event.sessionId,
              scadCode: event.scadCode,
            });
          }
        });

        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  streaming: false,
                  content:
                    message.content.trim().length > 0
                      ? message.content
                      : streamedText.trim().length > 0
                        ? streamedText
                        : action.type === "confirm"
                          ? "OpenSCAD code generated."
                          : action.type === "generate"
                            ? "Blueprint generated."
                            : "Update applied.",
                }
              : message,
          ),
        );
      } catch (streamError) {
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  streaming: false,
                  content: "Request failed before a response was completed.",
                }
              : message,
          ),
        );
        setError(
          streamError instanceof Error
            ? streamError.message
            : "Generation failed.",
        );
      } finally {
        setActiveAction(null);
      }
    },
    [applySessionState, nextMessageId],
  );

  const onSendChatMessage = useCallback(async () => {
    const trimmed = chatInput.trim();
    if (!trimmed) {
      return;
    }
    setChatInput("");

    if (!sessionId) {
      await runBlueprintAction(trimmed, {
        type: "generate",
        endpoint: "/api/blueprint/generate",
        payload: { description: trimmed },
      });
      return;
    }

    if (!hasCode) {
      await runBlueprintAction(trimmed, {
        type: "refine-blueprint",
        endpoint: "/api/blueprint/refine",
        payload: { sessionId, feedback: trimmed },
      });
      return;
    }

    await runBlueprintAction(trimmed, {
      type: "refine-code",
      endpoint: "/api/blueprint/refine-code",
      payload: { sessionId, feedback: trimmed },
    });
  }, [chatInput, hasCode, runBlueprintAction, sessionId]);

  const onConfirmBlueprint = useCallback(async () => {
    const sid = sessionId?.trim();
    if (!sid) {
      return;
    }
    await runBlueprintAction("Confirm blueprint and generate the 3D model.", {
      type: "confirm",
      endpoint: "/api/blueprint/confirm",
      payload: { sessionId: sid },
    });
  }, [runBlueprintAction, sessionId]);

  const onLoadSession = useCallback(async () => {
    const sid = sessionInput.trim();
    if (!sid) {
      return;
    }
    setError(null);
    try {
      const response = await fetch(`/api/blueprint/session/${sid}`);
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        throw new Error(
          errorPayload?.error ?? errorPayload?.detail ?? "Session load failed.",
        );
      }
      const payload = (await response.json()) as BlueprintSessionState;
      applySessionState(payload);
      setChatMessages((current) => [
        ...current,
        {
          id: nextMessageId(),
          role: "system",
          content: `Loaded session ${sid}.`,
        },
      ]);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Session load failed.",
      );
    }
  }, [applySessionState, nextMessageId, sessionInput]);

  const handleCaptureReady = useCallback((capture: () => string | null) => {
    captureRef.current = capture;
  }, []);

  const handleModelLoaded = useCallback(() => {
    setCaptureSignal(Date.now());
  }, []);

  return (
    <div
      className={`${embedded ? "h-full min-h-0" : "h-[calc(100vh-7.5rem)] min-h-[520px]"} w-full overflow-hidden rounded-xl border lg:grid lg:grid-cols-[400px_1fr]`}
    >
      <aside className="border-b p-5 sm:p-6 lg:border-b-0 lg:border-r overflow-y-auto">
        <div className="mb-5 space-y-6">
          {!embedded ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/assets">
                <ArrowLeft className="size-4" />
                Back to assets
              </Link>
            </Button>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight">Text to 3D</h1>
        </div>

        <div className="space-y-3 mt-6">
          {/* {sessionId ? (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Session: {sessionId}
            </p>
          ) : null} */}
          {/* <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Stage: {conversationStage}
          </p> */}

          <div className="h-[340px] overflow-y-auto rounded-lg border bg-muted/20 p-3 space-y-3">
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[95%] rounded-lg px-3 py-3 text-sm ${
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : message.role === "assistant"
                      ? "bg-background border"
                      : "mx-auto bg-muted text-muted-foreground text-xs"
                }`}
              >
                {message.content
                  ? renderChatText(message.content)
                  : message.streaming
                    ? "..."
                    : ""}
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>

          <div className="space-y-2">
            <Textarea
              rows={3}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={
                !sessionId
                  ? "Describe the object"
                  : !hasCode
                    ? "Ask for blueprint changes"
                    : "Ask for model refinements"
              }
              disabled={Boolean(activeAction)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!activeAction) {
                    void onSendChatMessage();
                  }
                }
              }}
            />
            <Button
              className="w-full"
              size="lg"
              onClick={() => void onSendChatMessage()}
              disabled={Boolean(activeAction) || chatInput.trim().length === 0}
            >
              {activeAction ? <Spinner /> : <Send className="size-4" />}
              {activeAction === "generate"
                ? "Generating blueprint..."
                : activeAction === "refine-blueprint"
                  ? "Refining blueprint..."
                  : activeAction === "refine-code"
                    ? "Refining model..."
                    : activeAction === "confirm"
                      ? "Generating model..."
                      : "Send"}
            </Button>
            {sessionId && hasBlueprint && !hasCode && !activeAction && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void onConfirmBlueprint()}
                size="lg"
              >
                {activeAction === "confirm" && <Spinner />}
                Finalize and generate model
                {activeAction !== "confirm" && <ArrowRight />}
              </Button>
            )}
          </div>

          <div className="space-y-2 mt-8">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Load session
            </p>
            <div className="flex gap-2">
              <Input
                value={sessionInput}
                onChange={(event) => setSessionInput(event.target.value)}
                placeholder="Paste session ID"
                disabled={Boolean(activeAction)}
              />
              <Button
                variant="outline"
                onClick={() => void onLoadSession()}
                disabled={
                  Boolean(activeAction) || sessionInput.trim().length === 0
                }
              >
                Load
              </Button>
            </div>
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>
      </aside>

      <section className="h-full overflow-y-auto p-5 sm:p-6 space-y-6">
        <div className="rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Blueprint preview</h2>
          </div>
          {hasBlueprint ? (
            <iframe
              title="Generated blueprint"
              srcDoc={blueprintHtml}
              className="h-[460px] w-full"
              sandbox=""
            />
          ) : (
            <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">
              Not available yet
            </div>
          )}
        </div>

        <div className="rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">3D model preview</h2>
          </div>
          {modelPreviewUrl ? (
            <div className="h-[460px] w-full overflow-hidden bg-[#06090f]">
              <TrellisModelViewer
                modelUrl={modelPreviewUrl}
                modelMimeType={modelPreviewMimeType}
                modelFileName={modelPreviewName}
                onCaptureReady={handleCaptureReady}
                onModelLoaded={handleModelLoaded}
                showLightingControls={false}
              />
            </div>
          ) : (
            <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">
              {modelPreviewLoading
                ? "Rendering preview..."
                : "Not available yet"}
            </div>
          )}
          {modelPreviewLoading && modelPreviewUrl ? (
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              Refreshing preview...
            </div>
          ) : null}
          {modelPreviewError ? (
            <div className="border-t px-4 py-2 text-xs text-red-400">
              {modelPreviewError}
            </div>
          ) : null}
          {assetSaveError ? (
            <div className="border-t px-4 py-2 text-xs text-red-400">
              {assetSaveError}
            </div>
          ) : null}
          {assetCreated ? (
            <div className="border-t px-4 py-2 text-xs text-cyan-100">
              {embedded ? (
                "Model was saved as an asset. You can now import it from the Assets tab."
              ) : (
                <span className="flex items-center gap-2">
                  Model was saved as an asset.
                  {generatedAssetId ? (
                    <Link
                      href={`/assets/${generatedAssetId}`}
                      className="inline-flex items-center gap-1 underline"
                    >
                      View asset
                      <ArrowRight className="size-3" />
                    </Link>
                  ) : null}
                </span>
              )}
            </div>
          ) : null}
        </div>

      </section>
    </div>
  );
}
