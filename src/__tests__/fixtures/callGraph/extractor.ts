/** Stands in for src/services/aiClient.ts#extractDocument — the seed of the taint. */
export async function extractDocument(req: { fileBase64: string; modelId: string }): Promise<string> {
  return `${req.modelId}:${req.fileBase64.length}`;
}

/** A second export of the same module that is NOT a root — nothing may be tainted through it. */
export function formatFileSize(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}
