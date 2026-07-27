import type { ApiResult, Episode, ImportRejectedResult, Job } from "../shared/domain";

const coreUrl = "http://127.0.0.1:43120/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${coreUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const body = await response.json() as ApiResult<T> | { code: string; message: string };
  if (!response.ok) throw new Error("message" in body ? body.message : `Request failed (${response.status})`);
  return (body as ApiResult<T>).data;
}

export const api = {
  episodes: (search = "") => request<Episode[]>(`/library/episodes?search=${encodeURIComponent(search)}`),
  jobs: () => request<Job[]>("/jobs"),
  importPaths: (paths: string[]) => request<{
    imported: Episode[];
    duplicates: Episode[];
    rejected: ImportRejectedResult[];
  }>("/library/import", { method: "POST", body: JSON.stringify({ paths }) }),
  startAnalysis: (episodeId: string) => request<Job>("/analysis/start", {
    method: "POST", body: JSON.stringify({ episodeId, provider: "local" })
  })
};
