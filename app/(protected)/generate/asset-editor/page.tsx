import AssetEditorWorkbench from "@/app/(protected)/generate/components/asset-editor-workbench";
import { getAssetDisplayTitle, getAssetForUser } from "@/lib/projects";
import { requireSession } from "@/lib/session";

export default async function AssetEditorPage({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string }>;
}) {
  const session = await requireSession();
  const { assetId: rawAssetId } = await searchParams;
  const assetId = typeof rawAssetId === "string" ? rawAssetId.trim() : "";

  const initialAssetRecord = assetId
    ? await getAssetForUser(assetId, session.user.id)
    : null;

  const initialAsset = initialAssetRecord
    ? {
        id: initialAssetRecord.id,
        title: getAssetDisplayTitle(initialAssetRecord),
        fileName: initialAssetRecord.fileName,
        mimeType: initialAssetRecord.mimeType,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Asset editor</h1>
      </header>
      <AssetEditorWorkbench initialAsset={initialAsset} />
    </main>
  );
}
