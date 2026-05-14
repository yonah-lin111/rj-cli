import type {
  RankingType,
  RankingResponse,
  CircleListResponse,
  CircleDetail,
  CircleWorksResponse,
  CircleLatestWorksResponse,
  WorksListResponse,
  WorksQueryPreset,
} from "../types";

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "操作失败");
  return data;
}

export interface RankingParams {
  ranking_type: RankingType;
  page: number;
  page_size: number;
  rj_code?: string;
  title?: string;
  circle?: string;
  cv?: string;
}

export async function fetchRanking(params: RankingParams): Promise<RankingResponse> {
  const q = new URLSearchParams({
    ranking_type: params.ranking_type,
    page: String(params.page),
    page_size: String(params.page_size),
  });
  if (params.rj_code) q.set("rj_code", params.rj_code);
  if (params.title) q.set("title", params.title);
  if (params.circle) q.set("circle", params.circle);
  if (params.cv) q.set("cv", params.cv);
  const res = await fetch(`/api/ranking?${q}`);
  const data = (await res.json()) as RankingResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "加载失败");
  return data;
}

export interface CircleListParams {
  page: number;
  page_size: number;
  name?: string;
  nickname?: string;
  remark?: string;
}

export async function fetchCircleList(params: CircleListParams): Promise<CircleListResponse> {
  const q = new URLSearchParams({ page: String(params.page), page_size: String(params.page_size) });
  if (params.name) q.set("name", params.name);
  if (params.nickname) q.set("nickname", params.nickname);
  if (params.remark) q.set("remark", params.remark);
  const res = await fetch(`/api/circle/list?${q}`);
  const data = (await res.json()) as CircleListResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "加载失败");
  return data;
}

export async function fetchCircleDetail(name: string): Promise<CircleDetail> {
  const q = new URLSearchParams({ name });
  const res = await fetch(`/api/circle/detail?${q}`);
  const data = (await res.json()) as CircleDetail & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "加载失败");
  return data;
}

export interface CircleWorksParams {
  circle_name: string;
  page: number;
  page_size: number;
  rj_code?: string;
  title?: string;
}

export async function fetchCircleWorks(params: CircleWorksParams): Promise<CircleWorksResponse> {
  const q = new URLSearchParams({
    circle_name: params.circle_name,
    page: String(params.page),
    page_size: String(params.page_size),
  });
  if (params.rj_code) q.set("rj_code", params.rj_code);
  if (params.title) q.set("title", params.title);
  const res = await fetch(`/api/circle/works?${q}`);
  const data = (await res.json()) as CircleWorksResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "加载失败");
  return data;
}

export async function fetchCircleLatestWorks(circleName: string, limit = 10): Promise<CircleLatestWorksResponse> {
  const q = new URLSearchParams({ circle_name: circleName, limit: String(limit) });
  const res = await fetch(`/api/circle/latest-works?${q}`);
  const data = (await res.json()) as CircleLatestWorksResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "加载失败");
  return data;
}

export interface WorksListParams {
  preset?: WorksQueryPreset;
  page: number;
  page_size: number;
  circle?: string;
  rj_code?: string;
  title?: string;
  source?: string;
  status?: number;
}

export async function fetchWorksList(params: WorksListParams): Promise<WorksListResponse> {
  const q = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.page_size),
  });
  if (params.preset && params.preset !== "all") q.set("preset", params.preset);
  if (params.circle) q.set("circle", params.circle);
  if (params.rj_code) q.set("rj_code", params.rj_code);
  if (params.title) q.set("title", params.title);
  if (params.source) q.set("source", params.source);
  if (params.status !== undefined) q.set("status", String(params.status));
  const res = await fetch(`/api/works/list?${q}`);
  const data = (await res.json()) as WorksListResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "加载失败");
  return data;
}

export interface UpdateWorkStatusResponse {
  ok: boolean;
  rj_code: string;
  status: number;
  message?: string;
}

export async function updateWorkStatus(rj_code: string, status: number): Promise<UpdateWorkStatusResponse> {
  return postJson<UpdateWorkStatusResponse>("/api/works/update-status", { rj_code, status });
}
