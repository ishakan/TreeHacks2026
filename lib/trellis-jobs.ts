type TrellisJobMeta = {
  userId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  persistedAssetId: string | null;
  storagePath: string | null;
};

const trellisJobs = new Map<string, TrellisJobMeta>();

export function registerTrellisJob({
  jobId,
  userId,
  projectId,
  title,
  description,
}: {
  jobId: string;
  userId: string;
  projectId: string | null;
  title: string;
  description: string | null;
}) {
  trellisJobs.set(jobId, {
    userId,
    projectId,
    title,
    description,
    persistedAssetId: null,
    storagePath: null,
  });
}

export function getTrellisJobMeta(jobId: string) {
  return trellisJobs.get(jobId) ?? null;
}

export function markTrellisJobPersisted({
  jobId,
  assetId,
  storagePath,
}: {
  jobId: string;
  assetId: string;
  storagePath: string;
}) {
  const current = trellisJobs.get(jobId);
  if (!current) {
    return;
  }

  trellisJobs.set(jobId, {
    ...current,
    persistedAssetId: assetId,
    storagePath,
  });
}
