import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { worksListTool, worksDeleteTool, worksUpdateStatusTool, circleListTool, circleGetTool, updateCircleTool, circleDeleteTool, circleWorksListTool, circleWorkRemoveTool, circleLatestWorksListTool, circleLatestWorkAddTool, rankListTool, rankAddWorkTool, rankRemoveWorkTool, rankAddCircleTool, checkRjExistsTool, checkCircleExistsTool, addWorkToCircleTool } from "../tools/rj-server/index.ts";
import type { RankSelection } from "../ui/rank-selector.ts";

const IS_DEV = process.env.RJ_WEB_DEV === "1";
const VITE_PORT = process.env.VITE_PORT ?? "5173";
const DIST_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".json": "application/json; charset=utf-8",
};

export const startRankPageServer = async (): Promise<Server> => {
  const server = createServer((req, res) => {
    void handleRankPageRequest(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
};

const handleRankPageRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/rank") {
    await sendRankPageHtml(res);
    return;
  }
  if (url.pathname === "/circle") {
    await sendCirclePageHtml(res);
    return;
  }
  if (url.pathname === "/works") {
    await sendWorksPageHtml(res);
    return;
  }
  if (!IS_DEV && url.pathname.startsWith("/assets/")) {
    await sendStaticAsset(url.pathname, res);
    return;
  }
  if (url.pathname === "/api/ranking") {
    await sendRankPageData(url, res);
    return;
  }
  if (url.pathname === "/api/circle/list") {
    sendCirclePageData(url, res);
    return;
  }
  if (url.pathname === "/api/circle/detail") {
    sendCircleDetailData(url, res);
    return;
  }
  if (url.pathname === "/api/circle/works") {
    sendCircleWorksData(url, res);
    return;
  }
  if (url.pathname === "/api/circle/latest-works") {
    await sendCircleLatestWorksData(url, res);
    return;
  }
  if (url.pathname === "/api/works/list") {
    sendWorksPageData(url, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/works/delete") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => worksDeleteTool(body as unknown as Parameters<typeof worksDeleteTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/works/update-status") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => worksUpdateStatusTool(body as unknown as Parameters<typeof worksUpdateStatusTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/latest-works/add") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => circleLatestWorkAddTool(body as unknown as Parameters<typeof circleLatestWorkAddTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/rj/check") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => checkRjExistsTool(body as unknown as Parameters<typeof checkRjExistsTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/rj/add") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => rankAddWorkTool(body as unknown as Parameters<typeof rankAddWorkTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/rj/remove") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => rankRemoveWorkTool(body as unknown as Parameters<typeof rankRemoveWorkTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/check") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => checkCircleExistsTool(body as unknown as Parameters<typeof checkCircleExistsTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/add") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => rankAddCircleTool(body as unknown as Parameters<typeof rankAddCircleTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/update") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => updateCircleTool(body as unknown as Parameters<typeof updateCircleTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/work/add") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => addWorkToCircleTool(body as unknown as Parameters<typeof addWorkToCircleTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/work/remove") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => circleWorkRemoveTool(body as unknown as Parameters<typeof circleWorkRemoveTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/remove") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => circleDeleteTool(body as unknown as Parameters<typeof circleDeleteTool>[0]));
    return;
  }
  sendJson(res, { error: "Not found" }, 404);
};

const sendRankPageData = async (url: URL, res: ServerResponse): Promise<void> => {
  const rankingType = parseRankingType(url.searchParams.get("ranking_type"));
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1, 1000);
  const pageSize = parsePositiveInt(url.searchParams.get("page_size"), 20, 5, 100);
  const result = await rankListTool({
    ranking_type: rankingType,
    page,
    page_size: pageSize,
    rj_code: url.searchParams.get("rj_code")?.trim() || undefined,
    title: url.searchParams.get("title")?.trim() || undefined,
    circle: url.searchParams.get("circle")?.trim() || undefined,
    cv: url.searchParams.get("cv")?.trim() || undefined,
  });
  if (result.isError) {
    sendJson(res, { error: result.content }, 500);
    return;
  }
  sendJson(res, JSON.parse(result.content));
};

const sendCirclePageData = (url: URL, res: ServerResponse): void => {
  const result = circleListTool({
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1, 1000),
    page_size: parsePositiveInt(url.searchParams.get("page_size"), 20, 1, 100),
    name: url.searchParams.get("name")?.trim() || undefined,
    nickname: url.searchParams.get("nickname")?.trim() || undefined,
    remark: url.searchParams.get("remark")?.trim() || undefined,
  });
  if (result.isError) {
    sendJson(res, { error: result.content }, 500);
    return;
  }
  sendJson(res, JSON.parse(result.content));
};

const sendCircleDetailData = (url: URL, res: ServerResponse): void => {
  const result = circleGetTool({ name: url.searchParams.get("name")?.trim() || "" });
  if (result.isError) {
    sendJson(res, { error: result.content }, 500);
    return;
  }
  sendJson(res, JSON.parse(result.content));
};

const sendCircleWorksData = (url: URL, res: ServerResponse): void => {
  const result = circleWorksListTool({
    circle_name: url.searchParams.get("circle_name")?.trim() || "",
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1, 1000),
    page_size: parsePositiveInt(url.searchParams.get("page_size"), 20, 1, 100),
    rj_code: url.searchParams.get("rj_code")?.trim() || undefined,
    title: url.searchParams.get("title")?.trim() || undefined,
  });
  if (result.isError) {
    sendJson(res, { error: result.content }, 500);
    return;
  }
  sendJson(res, JSON.parse(result.content));
};

const sendCircleLatestWorksData = async (url: URL, res: ServerResponse): Promise<void> => {
  const circleName = url.searchParams.get("circle_name")?.trim() || "";
  const limit = parsePositiveInt(url.searchParams.get("limit"), 10, 1, 20);
  const result = await circleLatestWorksListTool({ circle_name: circleName, limit });
  if (result.isError) {
    sendJson(res, { error: result.content }, 500);
    return;
  }
  sendJson(res, JSON.parse(result.content));
};

const parseWorksPreset = (value: string | null): "all" | "latest-added" | "latest-undownloaded" => {
  if (value === "latest-added" || value === "latest-undownloaded") return value;
  return "all";
};

const sendWorksPageData = (url: URL, res: ServerResponse): void => {
  const preset = parseWorksPreset(url.searchParams.get("preset"));
  const statusParam = url.searchParams.get("status");
  const status = statusParam == null || statusParam.trim() === ""
    ? (preset === "latest-undownloaded" ? 0 : undefined)
    : parsePositiveInt(statusParam, 0, 0, 2);
  const result = worksListTool({
    preset,
    page: parsePositiveInt(url.searchParams.get("page"), 1, 1, 1000),
    page_size: parsePositiveInt(url.searchParams.get("page_size"), 20, 1, 100),
    rj_code: url.searchParams.get("rj_code")?.trim() || undefined,
    title: url.searchParams.get("title")?.trim() || undefined,
    circle: url.searchParams.get("circle")?.trim() || undefined,
    source: url.searchParams.get("source")?.trim() || undefined,
    status,
  });
  if (result.isError) {
    sendJson(res, { error: result.content }, 500);
    return;
  }
  sendJson(res, {
    preset,
    ...JSON.parse(result.content),
  });
};

export const parseRankingType = (value: string | null): RankSelection["rankingType"] => {
  if (value === "7d" || value === "30d" || value === "year") return value;
  return "24h";
};

export const parsePositiveInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const readJsonBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
};

const sendToolResponse = async (res: ServerResponse, run: () => Promise<{ content: string; isError: boolean }> | { content: string; isError: boolean }): Promise<void> => {
  try {
    const result = await run();
    if (result.isError) {
      sendJson(res, { error: result.content }, 500);
      return;
    }
    sendJson(res, JSON.parse(result.content));
  } catch (err) {
    sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

const sendJson = (res: ServerResponse, data: unknown, statusCode = 200): void => {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(body);
};

const sendDistHtml = async (res: ServerResponse, fileName: string): Promise<void> => {
  try {
    const html = await readFile(join(DIST_DIR, fileName), "utf-8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  } catch {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Web assets missing: web/dist/${fileName}. Run: pnpm build:web`);
  }
};

const sendRankPageHtml = async (res: ServerResponse): Promise<void> => {
  if (IS_DEV) {
    res.writeHead(302, { location: `http://127.0.0.1:${VITE_PORT}/` });
    res.end();
    return;
  }
  await sendDistHtml(res, "index.html");
};

const sendCirclePageHtml = async (res: ServerResponse): Promise<void> => {
  if (IS_DEV) {
    res.writeHead(302, { location: `http://127.0.0.1:${VITE_PORT}/circle.html` });
    res.end();
    return;
  }
  await sendDistHtml(res, "circle.html");
};

const sendWorksPageHtml = async (res: ServerResponse): Promise<void> => {
  if (IS_DEV) {
    res.writeHead(302, { location: `http://127.0.0.1:${VITE_PORT}/works.html` });
    res.end();
    return;
  }
  await sendDistHtml(res, "works.html");
};

const sendStaticAsset = async (pathname: string, res: ServerResponse): Promise<void> => {
  const safePath = pathname.replace(/\.\./g, "").replace(/^\/+/, "");
  const filePath = join(DIST_DIR, safePath);
  try {
    const data = await readFile(filePath);
    const mime = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
};