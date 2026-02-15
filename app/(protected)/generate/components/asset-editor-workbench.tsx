"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AssetCardThumbnail from "@/components/asset-card-thumbnail";
import AssetEditor from "@/components/asset-editor";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

type SearchAsset = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  url: string;
};

type InitialAsset = {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
};

type AssetEditorWorkbenchProps = {
  initialAsset: InitialAsset | null;
};

function isEditableGlb(asset: { fileName: string; mimeType: string }) {
  return (
    asset.mimeType.toLowerCase().includes("gltf-binary") ||
    asset.fileName.toLowerCase().endsWith(".glb")
  );
}

function toSearchAsset(asset: InitialAsset): SearchAsset {
  return {
    id: asset.id,
    title: asset.title,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    url: `/api/assets/${asset.id}/file`,
  };
}

export default function AssetEditorWorkbench({ initialAsset }: AssetEditorWorkbenchProps) {
  const initialSearchAsset = useMemo(
    () => (initialAsset ? toSearchAsset(initialAsset) : null),
    [initialAsset],
  );
  const [assetOptions, setAssetOptions] = useState<SearchAsset[]>(
    initialSearchAsset && isEditableGlb(initialSearchAsset) ? [initialSearchAsset] : [],
  );
  const [selectedAsset, setSelectedAsset] = useState<SearchAsset | null>(
    initialSearchAsset && isEditableGlb(initialSearchAsset) ? initialSearchAsset : null,
  );
  const [assetPage, setAssetPage] = useState(0);
  const [assetHasMore, setAssetHasMore] = useState(false);
  const [assetLoading, setAssetLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const assetOptionsRef = useRef<SearchAsset[]>(assetOptions);

  useEffect(() => {
    assetOptionsRef.current = assetOptions;
  }, [assetOptions]);

  const mergeDeduped = useCallback((items: SearchAsset[]) => {
    return items.filter(
      (asset, index) => items.findIndex((item) => item.id === asset.id) === index,
    );
  }, []);

  const fetchAssetOptions = useCallback(
    async (page: number, append: boolean) => {
      const requestId = ++requestIdRef.current;
      setAssetLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          q: "",
          page: String(page),
          limit: "12",
        });

        const response = await fetch(`/api/assets/search?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to fetch assets.");
        }

        const payload = (await response.json()) as {
          assets: SearchAsset[];
          hasMore: boolean;
        };

        if (requestId !== requestIdRef.current) {
          return;
        }

        const fetched = payload.assets.filter((asset) => isEditableGlb(asset));
        const base =
          initialSearchAsset && isEditableGlb(initialSearchAsset)
            ? [initialSearchAsset, ...fetched]
            : fetched;
        const deduped = mergeDeduped(base);

        setAssetOptions((prev) => {
          if (!append) {
            return deduped;
          }
          return mergeDeduped([...prev, ...deduped]);
        });

        setAssetHasMore(payload.hasMore);
        setAssetPage(page);
        setSelectedAsset((prev) => {
          if (prev) {
            const source = append
              ? mergeDeduped([...assetOptionsRef.current, ...deduped])
              : deduped;
            return source.find((item) => item.id === prev.id) ?? prev;
          }

          if (initialSearchAsset && isEditableGlb(initialSearchAsset)) {
            return deduped.find((item) => item.id === initialSearchAsset.id) ?? initialSearchAsset;
          }

          return deduped[0] ?? null;
        });
      } catch (err) {
        if (!append) {
          setAssetOptions(
            initialSearchAsset && isEditableGlb(initialSearchAsset)
              ? [initialSearchAsset]
              : [],
          );
        }
        setAssetHasMore(false);
        setError(err instanceof Error ? err.message : "Failed to fetch assets.");
      } finally {
        if (requestId === requestIdRef.current) {
          setAssetLoading(false);
        }
      }
    },
    [initialSearchAsset, mergeDeduped],
  );

  useEffect(() => {
    void fetchAssetOptions(0, false);
  }, [fetchAssetOptions]);

  const selectedAssetLabel = useMemo(() => {
    if (!selectedAsset) {
      return "";
    }
    return `${selectedAsset.title} (${selectedAsset.fileName})`;
  }, [selectedAsset]);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Asset to edit</h2>
        </div>

        <div className="mt-3 space-y-3">
          <Combobox
            items={assetOptions}
            value={selectedAsset}
            onValueChange={setSelectedAsset}
            itemToStringLabel={(item) =>
              item ? `${item.title} (${item.fileName})` : ""
            }
            itemToStringValue={(item) => (item ? item.id : "")}
          >
            <ComboboxInput
              className="w-full"
              placeholder={assetLoading ? "Loading assets..." : "Choose a GLB asset..."}
              aria-label="Choose a GLB asset"
            />
            <ComboboxContent>
              <ComboboxEmpty>No editable GLB assets found.</ComboboxEmpty>
              <ComboboxList>
                {(asset: SearchAsset) => (
                  <ComboboxItem key={asset.id} value={asset}>
                    <span className="truncate">
                      {asset.title}{" "}
                      <span className="text-muted-foreground">({asset.fileName})</span>
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>

          {selectedAsset ? (
            <div className="flex items-center gap-3 rounded-md border p-2">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded border bg-muted/20">
                <AssetCardThumbnail
                  assetId={selectedAsset.id}
                  fileName={selectedAsset.fileName}
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{selectedAsset.title}</p>
                <p className="truncate text-xs text-muted-foreground">{selectedAssetLabel}</p>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{assetLoading ? "Loading..." : `${assetOptions.length} loaded`}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!assetHasMore || assetLoading}
              onClick={() => void fetchAssetOptions(assetPage + 1, true)}
            >
              Load more
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </section>

      {selectedAsset ? (
        <AssetEditor
          key={selectedAsset.id}
          assetId={selectedAsset.id}
          fileName={selectedAsset.fileName}
          mimeType={selectedAsset.mimeType}
        />
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Choose a GLB asset to start editing.
        </div>
      )}
    </div>
  );
}
