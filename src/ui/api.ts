import type { ApiResult, Episode, ImportRejectedResult, Job, Page } from "../shared/domain";

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

async function requestAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const page: Page<T> = await request<Page<T>>(
      cursor === null ? path : `${path}${separator}cursor=${encodeURIComponent(cursor)}`
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

export const api = {
  episodes: (search = "") =>
    requestAll<Episode>(`/library/episodes?search=${encodeURIComponent(search)}`),
  jobs: () => requestAll<Job>("/jobs"),
  importPaths: (paths: string[]) => request<{
    imported: Episode[];
    duplicates: Episode[];
    rejected: ImportRejectedResult[];
  }>("/library/import", { method: "POST", body: JSON.stringify({ paths }) }),
  startAnalysis: (episodeId: string) => request<Job>("/analysis/start", {
    method: "POST", body: JSON.stringify({ episodeId, provider: "local" })
  })
};
