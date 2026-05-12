import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getRankingTool, queryCircleTool, getCircleDetailTool, updateCircleTool, queryCircleWorksTool, addWorkToCircleTool, removeWorkFromCircleTool, addRjFromRankingTool, removeRjTool, checkRjExistsTool, addCircleTool, removeCircleTool, checkCircleExistsTool } from "../tools/rj-server/index.ts";
import type { RankSelection } from "../ui/rank-selector.ts";

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
  if (url.pathname === "/") {
    sendRankPageHtml(res);
    return;
  }
  if (url.pathname === "/circle") {
    sendCirclePageHtml(res);
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
  if (req.method === "POST" && url.pathname === "/api/rj/check") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => checkRjExistsTool(body as unknown as Parameters<typeof checkRjExistsTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/rj/add") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => addRjFromRankingTool(body as unknown as Parameters<typeof addRjFromRankingTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/rj/remove") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => removeRjTool(body as unknown as Parameters<typeof removeRjTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/check") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => checkCircleExistsTool(body as unknown as Parameters<typeof checkCircleExistsTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/add") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => addCircleTool(body as unknown as Parameters<typeof addCircleTool>[0]));
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
    await sendToolResponse(res, () => removeWorkFromCircleTool(body as unknown as Parameters<typeof removeWorkFromCircleTool>[0]));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/circle/remove") {
    const body = await readJsonBody(req);
    await sendToolResponse(res, () => removeCircleTool(body as unknown as Parameters<typeof removeCircleTool>[0]));
    return;
  }
  sendJson(res, { error: "Not found" }, 404);
};

const sendRankPageData = async (url: URL, res: ServerResponse): Promise<void> => {
  const rankingType = parseRankingType(url.searchParams.get("ranking_type"));
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 1, 1000);
  const pageSize = parsePositiveInt(url.searchParams.get("page_size"), 20, 5, 100);
  const result = await getRankingTool({
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
  const result = queryCircleTool({
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
  const result = getCircleDetailTool({ name: url.searchParams.get("name")?.trim() || "" });
  if (result.isError) {
    sendJson(res, { error: result.content }, 500);
    return;
  }
  sendJson(res, JSON.parse(result.content));
};

const sendCircleWorksData = (url: URL, res: ServerResponse): void => {
  const result = queryCircleWorksTool({
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

const sendRankPageHtml = (res: ServerResponse): void => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
    res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RJ 排行榜</title>
  <style>
    :root { color-scheme: dark; --bg: #0f172a; --panel: #111827; --line: #243044; --text: #e5e7eb; --muted: #94a3b8; --accent: #38bdf8; --danger: #fb7185; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1 { margin: 0 0 18px; font-size: 24px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: 0 16px 50px rgba(0, 0, 0, .24); }
    .filters { display: grid; grid-template-columns: repeat(6, minmax(140px, 1fr)); gap: 12px; align-items: end; margin-bottom: 16px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
    input, select, button { height: 36px; border-radius: 8px; border: 1px solid var(--line); background: #0b1220; color: var(--text); padding: 0 10px; font-size: 14px; }
    button { cursor: pointer; background: #0e7490; border-color: #0891b2; font-weight: 600; }
    button.secondary { background: #1f2937; border-color: #334155; }
    .toolbar { display: flex; justify-content: flex-end; margin: 0 0 12px; }
    .summary { margin: 8px 0 12px; color: var(--muted); font-size: 13px; }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: var(--table-min-width, 780px); }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
    th { position: sticky; top: 0; background: #111827; color: #cbd5e1; white-space: nowrap; }
    tr:hover td { background: rgba(56, 189, 248, .06); }
    a { color: var(--accent); text-decoration: none; }
    .thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; background: #020617; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; max-width: 260px; }
    .tag { padding: 2px 6px; border-radius: 999px; background: #1e293b; color: #cbd5e1; font-size: 12px; }
    .actions { display: grid; gap: 6px; min-width: 92px; }
    .actions button { height: 30px; padding: 0 8px; font-size: 12px; }
    .actions button.remove { background: #9f1239; border-color: #be123c; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    .pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 14px; color: var(--muted); }
    .error { color: var(--danger); }
    @media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(140px, 1fr)); } }
  </style>
</head>
<body>
  <h1>RJ 排行榜</h1>
  <main class="panel">
    <section class="filters">
      <label>排行
        <select id="ranking_type">
          <option value="24h">天</option>
          <option value="7d">周</option>
          <option value="30d">月</option>
          <option value="year">年</option>
        </select>
      </label>
      <label>RJ号 <input id="rj_code" placeholder="输入 RJ 号"></label>
      <label>标题 <input id="title" placeholder="模糊查询标题"></label>
      <label>社团 <input id="circle" placeholder="模糊查询社团"></label>
      <label>CV <input id="cv" placeholder="模糊查询 CV"></label>
      <label>每页
        <select id="page_size">
          <option>5</option><option>10</option><option>15</option><option>20</option><option>25</option><option>30</option><option>40</option><option>60</option><option>100</option>
        </select>
      </label>
      <button id="search">查询</button>
      <button id="reset" class="secondary">重置</button>
    </section>
    <div id="summary" class="summary">加载中...</div>
    <div class="toolbar">
      <button id="toggle_details" class="secondary">显示表格信息</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>排名</th><th>RJ号</th><th>社团</th><th>CV</th><th>发售日</th><th>操作</th></tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <section class="pager">
      <button id="prev" class="secondary">上一页</button>
      <span id="page_info"></span>
      <button id="next" class="secondary">下一页</button>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const state = { page: 1, total: 0, items: [], rjExistsMap: {}, circleExistsMap: {}, showDetails: false };
    const ids = ["ranking_type", "rj_code", "title", "circle", "cv", "page_size"];
    const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    el.ranking_type.value = params.get("ranking_type") || "24h";
    el.page_size.value = params.get("page_size") || "20";

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const link = (href, text) => href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(text) + '</a>' : escapeHtml(text);

    async function loadRanking() {
      const query = new URLSearchParams({ ranking_type: el.ranking_type.value, page: String(state.page), page_size: el.page_size.value });
      for (const key of ["rj_code", "title", "circle", "cv"]) {
        if (el[key].value.trim()) query.set(key, el[key].value.trim());
      }
      history.replaceState(null, "", "?" + query.toString());
      document.getElementById("summary").textContent = "加载中...";
      const response = await fetch("/api/ranking?" + query.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      state.total = data.total || 0;
      state.items = data.items || [];
      await refreshExistsMaps(state.items);
      renderRows();
      renderPager();
      document.getElementById("summary").textContent = data.ranking_type + " 排行榜，共 " + state.total + " 条";
    }

    async function postJson(url, body) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败");
      return data;
    }

    async function refreshExistsMaps(items) {
      const rjCodes = [...new Set(items.map(item => item.rj_code).filter(Boolean))];
      const circleNames = [...new Set(items.map(item => item.circle).filter(Boolean))];
      const [rjData, circleData] = await Promise.all([
        rjCodes.length ? postJson("/api/rj/check", { rj_codes: rjCodes }) : Promise.resolve({ exists: {} }),
        circleNames.length ? postJson("/api/circle/check", { names: circleNames }) : Promise.resolve({ exists: {} }),
      ]);
      state.rjExistsMap = rjData.exists || {};
      state.circleExistsMap = circleData.exists || {};
    }

    function renderRows() {
      const items = state.items;
      const tbody = document.getElementById("rows");
      const headers = state.showDetails
        ? ["排名", "封面", "RJ号", "标题", "社团", "CV", "标签", "全年龄", "发售日", "操作"]
        : ["排名", "RJ号", "社团", "CV", "发售日", "操作"];
      document.querySelector("thead tr").innerHTML = headers.map(header => '<th>' + header + '</th>').join('');
      document.querySelector("table").style.setProperty("--table-min-width", state.showDetails ? "1280px" : "780px");
      document.getElementById("toggle_details").textContent = state.showDetails ? "隐藏表格信息" : "显示表格信息";
      tbody.innerHTML = items.map(item => {
        const commonCells =
          '<td>' + escapeHtml(item.rank ?? "-") + '</td>' +
          '<td>' + escapeHtml(item.rj_code) + '</td>' +
          '<td>' + link(item.circle_url, item.circle || "") + '</td>' +
          '<td>' + escapeHtml(item.cv || "") + '</td>' +
          '<td>' + escapeHtml(item.release_date || "") + '</td>' +
          '<td>' + actionButtons(item) + '</td>';
        if (!state.showDetails) return '<tr>' + commonCells + '</tr>';
        return '<tr>' +
          '<td>' + escapeHtml(item.rank ?? "-") + '</td>' +
          '<td>' + (item.thumbnail ? '<img class="thumb" src="' + escapeHtml(item.thumbnail) + '" loading="lazy">' : '') + '</td>' +
          '<td>' + escapeHtml(item.rj_code) + '</td>' +
          '<td>' + link(item.title_url, item.title) + '</td>' +
          '<td>' + link(item.circle_url, item.circle || "") + '</td>' +
          '<td>' + escapeHtml(item.cv || "") + '</td>' +
          '<td><div class="tags">' + (item.tags || []).map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div></td>' +
          '<td>' + (item.is_all_ages ? '是' : '否') + '</td>' +
          '<td>' + escapeHtml(item.release_date || "") + '</td>' +
          '<td>' + actionButtons(item) + '</td>' +
        '</tr>';
      }).join('');
      if (!items.length) tbody.innerHTML = '<tr><td colspan="' + headers.length + '">暂无数据</td></tr>';
    }

    function actionButtons(item) {
      const rjCode = item.rj_code || "";
      const circle = item.circle || "";
      const rjExists = !!state.rjExistsMap[rjCode];
      const circleExists = !!state.circleExistsMap[circle];
      return '<div class="actions">' +
        (rjCode ? '<button data-action="' + (rjExists ? 'remove-rj' : 'add-rj') + '" data-rj="' + escapeHtml(rjCode) + '" class="' + (rjExists ? 'remove' : '') + '">' + (rjExists ? '移除RJ' : '添加RJ') + '</button>' : '') +
        (circle ? '<button data-action="' + (circleExists ? 'remove-circle' : 'add-circle') + '" data-circle="' + escapeHtml(circle) + '" class="' + (circleExists ? 'remove' : '') + '">' + (circleExists ? '移除社团' : '添加社团') + '</button>' : '') +
      '</div>';
    }

    function renderPager() {
      const pageSize = Number(el.page_size.value);
      const pages = Math.max(1, Math.ceil(state.total / pageSize));
      document.getElementById("page_info").textContent = state.page + " / " + pages;
      document.getElementById("prev").disabled = state.page <= 1;
      document.getElementById("next").disabled = state.page >= pages;
    }

    let timer;
    function debouncedSearch() {
      clearTimeout(timer);
      timer = setTimeout(() => { state.page = 1; loadRanking().catch(showError); }, 300);
    }
    function showError(error) {
      document.getElementById("summary").innerHTML = '<span class="error">' + escapeHtml(error.message || error) + '</span>';
    }

    async function handleAction(event) {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      const rjCode = button.dataset.rj;
      const circle = button.dataset.circle;
      const item = state.items.find(row => row.rj_code === rjCode || row.circle === circle) || {};
      button.disabled = true;
      try {
        if (action === "add-rj" && rjCode) {
          await postJson("/api/rj/add", { rj_code: rjCode, ranking_type: el.ranking_type.value });
          state.rjExistsMap[rjCode] = true;
        } else if (action === "remove-rj" && rjCode) {
          await postJson("/api/rj/remove", { rj_code: rjCode });
          state.rjExistsMap[rjCode] = false;
        } else if (action === "add-circle" && circle) {
          await postJson("/api/circle/add", { name: circle, circle_url: item.circle_url });
          state.circleExistsMap[circle] = true;
        } else if (action === "remove-circle" && circle) {
          await postJson("/api/circle/remove", { name: circle });
          state.circleExistsMap[circle] = false;
        }
        renderRows();
        document.getElementById("summary").textContent = "操作成功";
      } catch (error) {
        showError(error);
      } finally {
        button.disabled = false;
      }
    }

    document.getElementById("search").onclick = () => { state.page = 1; loadRanking().catch(showError); };
    document.getElementById("toggle_details").onclick = () => { state.showDetails = !state.showDetails; renderRows(); };
    document.getElementById("reset").onclick = () => {
      el.ranking_type.value = "24h";
      el.rj_code.value = "";
      el.title.value = "";
      el.circle.value = "";
      el.cv.value = "";
      state.page = 1;
      loadRanking().catch(showError);
    };
    document.getElementById("prev").onclick = () => { if (state.page > 1) { state.page--; loadRanking().catch(showError); } };
    document.getElementById("next").onclick = () => { state.page++; loadRanking().catch(showError); };
    document.getElementById("rows").onclick = event => { handleAction(event).catch(showError); };
    ids.forEach(id => el[id].addEventListener(id === "page_size" || id === "ranking_type" ? "change" : "input", debouncedSearch));
    loadRanking().catch(showError);
  </script>
</body>
</html>`);
};

const sendCirclePageHtml = (res: ServerResponse): void => {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>社团管理</title>
  <style>
    :root { color-scheme: dark; --bg: #0f172a; --panel: #111827; --line: #243044; --text: #e5e7eb; --muted: #94a3b8; --accent: #38bdf8; --danger: #fb7185; --ok: #22c55e; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1 { margin: 0 0 18px; font-size: 24px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, .6fr); gap: 16px; align-items: start; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: 0 16px 50px rgba(0, 0, 0, .24); margin-bottom: 16px; }
    .filters, .form-grid, .work-tools { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; align-items: end; margin-bottom: 16px; }
    .form-grid { grid-template-columns: 1fr; }
    .work-tools { grid-template-columns: repeat(4, minmax(120px, 1fr)); }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
    input, select, textarea, button { border-radius: 8px; border: 1px solid var(--line); background: #0b1220; color: var(--text); padding: 0 10px; font-size: 14px; }
    input, select, button { height: 36px; }
    textarea { min-height: 72px; padding: 8px 10px; resize: vertical; }
    button { cursor: pointer; background: #0e7490; border-color: #0891b2; font-weight: 600; }
    button.secondary { background: #1f2937; border-color: #334155; }
    button.remove { background: #9f1239; border-color: #be123c; }
    button:disabled, input:disabled { cursor: not-allowed; opacity: .55; }
    .summary, .hint { margin: 8px 0 12px; color: var(--muted); font-size: 13px; }
    .hint strong { color: var(--text); }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    #works_table { min-width: 860px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
    th { position: sticky; top: 0; background: #111827; color: #cbd5e1; white-space: nowrap; }
    tr:hover td { background: rgba(56, 189, 248, .06); }
    tr.selected td { background: rgba(56, 189, 248, .12); }
    a { color: var(--accent); text-decoration: none; }
    .pager, .actions, .button-row { display: flex; gap: 8px; align-items: center; }
    .pager { justify-content: flex-end; margin-top: 14px; color: var(--muted); }
    .actions button { height: 30px; padding: 0 8px; font-size: 12px; }
    .error { color: var(--danger); }
    .success { color: var(--ok); }
    @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } .filters, .work-tools { grid-template-columns: repeat(2, minmax(140px, 1fr)); } }
  </style>
</head>
<body>
  <h1>社团管理</h1>
  <div class=”grid”>
    <main>
      <section class=”panel”>
        <h2>社团列表</h2>
        <section class=”filters”>
          <label>社团名 <input id=”name” placeholder=”模糊查询社团名”></label>
          <label>昵称 <input id=”nickname” placeholder=”模糊查询昵称”></label>
          <label>备注 <input id=”remark” placeholder=”模糊查询备注”></label>
          <label>每页
            <select id=”page_size”>
              <option>5</option><option>10</option><option>15</option><option>20</option><option>25</option><option>30</option><option>40</option><option>60</option><option>100</option>
            </select>
          </label>
          <button id=”search”>查询</button>
          <button id=”reset” class=”secondary”>重置</button>
        </section>
        <div id=”summary” class=”summary”>加载中...</div>
        <div class=”table-wrap”>
          <table>
            <thead>
              <tr><th>ID</th><th>社团名</th><th>昵称</th><th>社团链接</th><th>备注</th><th>作品数</th><th>创建时间</th><th>操作</th></tr>
            </thead>
            <tbody id=”rows”></tbody>
          </table>
        </div>
        <section class=”pager”>
          <button id=”prev” class=”secondary”>上一页</button>
          <span id=”page_info”></span>
          <button id=”next” class=”secondary”>下一页</button>
        </section>
      </section>

      <section class=”panel” id=”works_panel”>
        <h2>社团作品</h2>
        <div id=”selected_circle” class=”hint”>请先在社团列表中选择”查看作品”。添加作品只支持本地 DB 已存在的 RJ；移除作品不会删除 RJ 记录。</div>
        <section class=”work-tools”>
          <label>RJ号 <input id=”work_rj_code” placeholder=”筛选 RJ 号”></label>
          <label>标题 <input id=”work_title” placeholder=”筛选标题”></label>
          <button id=”work_search”>查询作品</button>
          <label>每页
            <select id=”work_page_size”><option>5</option><option>10</option><option>20</option><option>30</option><option>50</option><option>100</option></select>
          </label>
        </section>
        <section class=”work-tools”>
          <label>添加作品 RJ号 <input id=”add_work_rj” placeholder=”RJ123456”></label>
          <button id=”add_work”>添加作品</button>
        </section>
        <div id=”works_summary” class=”summary”>未选择社团</div>
        <div class=”table-wrap”>
          <table id=”works_table”>
            <thead><tr><th>RJ号</th><th>标题</th><th>CV</th><th>发售日</th><th>来源</th><th>状态</th><th>操作</th></tr></thead>
            <tbody id=”work_rows”><tr><td colspan=”7”>未选择社团</td></tr></tbody>
          </table>
        </div>
        <section class=”pager”>
          <button id=”work_prev” class=”secondary”>上一页</button>
          <span id=”work_page_info”></span>
          <button id=”work_next” class=”secondary”>下一页</button>
        </section>
      </section>
    </main>

    <aside class=”panel”>
      <h2 id=”form_title”>新增社团</h2>
      <section class=”form-grid”>
        <label>社团名 <input id=”form_name” placeholder=”社团名”></label>
        <label>昵称 <input id=”form_nickname” placeholder=”默认等于社团名”></label>
        <label>社团链接 <input id=”form_circle_url” placeholder=”https://...”></label>
        <label>备注 <textarea id=”form_remark” placeholder=”备注”></textarea></label>
        <div class=”button-row”>
          <button id=”add_circle”>新增社团</button>
          <button id=”save_circle” class=”secondary”>保存修改</button>
          <button id=”clear_form” class=”secondary”>清空表单</button>
        </div>
      </section>
      <div class=”hint”>本轮不支持社团改名；删除社团不会删除作品，也不会自动清空作品的 rj.circle。</div>
      <div id=”form_message” class=”summary”></div>
    </aside>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    const state = { page: 1, total: 0, items: [], selectedCircle: "", workPage: 1, workTotal: 0, workItems: [], editing: false };
    const ids = ["name", "nickname", "remark", "page_size", "form_name", "form_nickname", "form_circle_url", "form_remark", "work_rj_code", "work_title", "work_page_size", "add_work_rj"];
    const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    el.page_size.value = params.get("page_size") || "20";
    el.work_page_size.value = "10";
    for (const key of ["name", "nickname", "remark"]) el[key].value = params.get(key) || "";

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const link = (href, text) => href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(text || href) + '</a>' : '-';
    const display = (value) => value !== undefined && value !== null && value !== "" ? escapeHtml(value) : '-';

    async function postJson(url, body) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败");
      return data;
    }

    async function loadCircles() {
      const query = new URLSearchParams({ page: String(state.page), page_size: el.page_size.value });
      for (const key of ["name", "nickname", "remark"]) if (el[key].value.trim()) query.set(key, el[key].value.trim());
      history.replaceState(null, "", "/circle?" + query.toString());
      document.getElementById("summary").textContent = "加载中...";
      const response = await fetch("/api/circle/list?" + query.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      state.total = data.total || 0;
      state.items = data.data || [];
      renderRows();
      renderPager();
      document.getElementById("summary").textContent = "社团列表，共 " + state.total + " 条";
    }

    async function loadWorks() {
      if (!state.selectedCircle) return;
      const query = new URLSearchParams({ circle_name: state.selectedCircle, page: String(state.workPage), page_size: el.work_page_size.value });
      if (el.work_rj_code.value.trim()) query.set("rj_code", el.work_rj_code.value.trim());
      if (el.work_title.value.trim()) query.set("title", el.work_title.value.trim());
      document.getElementById("works_summary").textContent = "加载中...";
      const response = await fetch("/api/circle/works?" + query.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      state.workTotal = data.total || 0;
      state.workItems = data.data || [];
      renderWorks();
      renderWorkPager();
      document.getElementById("works_summary").textContent = "作品列表，共 " + state.workTotal + " 条";
    }

    function renderRows() {
      const tbody = document.getElementById("rows");
      tbody.innerHTML = state.items.map(item => '<tr class="' + (item.name === state.selectedCircle ? 'selected' : '') + '">' +
        '<td>' + display(item.id) + '</td>' +
        '<td>' + display(item.name) + '</td>' +
        '<td>' + display(item.nickname) + '</td>' +
        '<td>' + link(item.circle_url) + '</td>' +
        '<td>' + display(item.remark) + '</td>' +
        '<td>' + display(item.work_count) + '</td>' +
        '<td>' + display(item.created_at) + '</td>' +
        '<td><div class="actions">' +
          '<button data-action="view" data-name="' + escapeHtml(item.name) + '">查看作品</button>' +
          '<button class="secondary" data-action="edit" data-name="' + escapeHtml(item.name) + '">编辑</button>' +
          '<button class="remove" data-action="delete" data-name="' + escapeHtml(item.name) + '">删除</button>' +
        '</div></td>' +
      '</tr>').join('');
      if (!state.items.length) tbody.innerHTML = '<tr><td colspan="8">暂无社团数据</td></tr>';
    }

    function renderWorks() {
      const tbody = document.getElementById("work_rows");
      tbody.innerHTML = state.workItems.map(item => '<tr>' +
        '<td>' + display(item.rj_code) + '</td>' +
        '<td>' + link(item.title_url, item.title) + '</td>' +
        '<td>' + display(item.cv) + '</td>' +
        '<td>' + display(item.release_date) + '</td>' +
        '<td>' + display(item.source) + '</td>' +
        '<td>' + display(item.status) + '</td>' +
        '<td><button class="remove" data-work-action="remove" data-rj="' + escapeHtml(item.rj_code) + '">移除</button></td>' +
      '</tr>').join('');
      if (!state.workItems.length) tbody.innerHTML = '<tr><td colspan="7">暂无作品</td></tr>';
    }

    function renderPager() {
      const pageSize = Number(el.page_size.value);
      const pages = Math.max(1, Math.ceil(state.total / pageSize));
      document.getElementById("page_info").textContent = state.page + " / " + pages;
      document.getElementById("prev").disabled = state.page <= 1;
      document.getElementById("next").disabled = state.page >= pages;
    }

    function renderWorkPager() {
      const pageSize = Number(el.work_page_size.value);
      const pages = Math.max(1, Math.ceil(state.workTotal / pageSize));
      document.getElementById("work_page_info").textContent = state.selectedCircle ? state.workPage + " / " + pages : "";
      document.getElementById("work_prev").disabled = !state.selectedCircle || state.workPage <= 1;
      document.getElementById("work_next").disabled = !state.selectedCircle || state.workPage >= pages;
    }

    function setEditing(item) {
      state.editing = !!item;
      document.getElementById("form_title").textContent = item ? "编辑社团" : "新增社团";
      el.form_name.disabled = !!item;
      el.form_name.value = item?.name || "";
      el.form_nickname.value = item?.nickname || "";
      el.form_circle_url.value = item?.circle_url || "";
      el.form_remark.value = item?.remark || "";
      document.getElementById("form_message").textContent = "";
    }

    async function saveCircle(isUpdate) {
      const body = { name: el.form_name.value.trim(), nickname: el.form_nickname.value.trim(), circle_url: el.form_circle_url.value.trim(), remark: el.form_remark.value.trim() };
      if (!body.name) throw new Error("社团名不能为空");
      await postJson(isUpdate ? "/api/circle/update" : "/api/circle/add", body);
      document.getElementById("form_message").innerHTML = '<span class="success">保存成功</span>';
      if (!isUpdate) setEditing(null);
      await loadCircles();
    }

    async function handleCircleAction(event) {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const name = button.dataset.name;
      const item = state.items.find(row => row.name === name);
      if (!name || !item) return;
      if (button.dataset.action === "view") {
        state.selectedCircle = name;
        state.workPage = 1;
        document.getElementById("selected_circle").innerHTML = '当前社团：<strong>' + escapeHtml(name) + '</strong>';
        renderRows();
        await loadWorks();
      } else if (button.dataset.action === "edit") {
        setEditing(item);
      } else if (button.dataset.action === "delete") {
        if (!confirm("确认删除社团“" + name + "”？不会删除作品，也不会清空作品所属社团。")) return;
        await postJson("/api/circle/remove", { name });
        if (state.selectedCircle === name) {
          state.selectedCircle = "";
          state.workItems = [];
          document.getElementById("selected_circle").textContent = "请先在社团列表中选择“查看作品”。添加作品只支持本地 DB 已存在的 RJ；移除作品不会删除 RJ 记录。";
          renderWorks();
          renderWorkPager();
        }
        await loadCircles();
      }
    }

    async function handleWorkAction(event) {
      const button = event.target.closest("button[data-work-action]");
      if (!button || !state.selectedCircle) return;
      const rjCode = button.dataset.rj;
      if (!rjCode || !confirm("确认从社团移除 " + rjCode + "？")) return;
      await postJson("/api/circle/work/remove", { circle_name: state.selectedCircle, rj_code: rjCode });
      await Promise.all([loadWorks(), loadCircles()]);
    }

    let timer;
    function debouncedSearch() {
      clearTimeout(timer);
      timer = setTimeout(() => { state.page = 1; loadCircles().catch(showError); }, 300);
    }
    function showError(error) {
      document.getElementById("summary").innerHTML = '<span class="error">' + escapeHtml(error.message || error) + '</span>';
    }
    function showWorkError(error) {
      document.getElementById("works_summary").innerHTML = '<span class="error">' + escapeHtml(error.message || error) + '</span>';
    }

    document.getElementById("search").onclick = () => { state.page = 1; loadCircles().catch(showError); };
    document.getElementById("reset").onclick = () => {
      el.name.value = ""; el.nickname.value = ""; el.remark.value = ""; state.page = 1; loadCircles().catch(showError);
    };
    document.getElementById("prev").onclick = () => { if (state.page > 1) { state.page--; loadCircles().catch(showError); } };
    document.getElementById("next").onclick = () => { state.page++; loadCircles().catch(showError); };
    document.getElementById("rows").onclick = event => { handleCircleAction(event).catch(showError); };
    document.getElementById("work_rows").onclick = event => { handleWorkAction(event).catch(showWorkError); };
    document.getElementById("work_search").onclick = () => { state.workPage = 1; loadWorks().catch(showWorkError); };
    document.getElementById("work_prev").onclick = () => { if (state.workPage > 1) { state.workPage--; loadWorks().catch(showWorkError); } };
    document.getElementById("work_next").onclick = () => { state.workPage++; loadWorks().catch(showWorkError); };
    document.getElementById("add_work").onclick = async () => {
      if (!state.selectedCircle) return showWorkError("请先选择社团");
      const rjCode = el.add_work_rj.value.trim();
      if (!rjCode) return showWorkError("请输入 RJ 号");
      try {
        await postJson("/api/circle/work/add", { circle_name: state.selectedCircle, rj_code: rjCode });
        el.add_work_rj.value = "";
        await Promise.all([loadWorks(), loadCircles()]);
      } catch (error) { showWorkError(error); }
    };
    document.getElementById("add_circle").onclick = () => { saveCircle(false).catch(error => { document.getElementById("form_message").innerHTML = '<span class="error">' + escapeHtml(error.message || error) + '</span>'; }); };
    document.getElementById("save_circle").onclick = () => { saveCircle(true).catch(error => { document.getElementById("form_message").innerHTML = '<span class="error">' + escapeHtml(error.message || error) + '</span>'; }); };
    document.getElementById("clear_form").onclick = () => setEditing(null);
    ids.filter(id => ["name", "nickname", "remark", "page_size"].includes(id)).forEach(id => el[id].addEventListener(id === "page_size" ? "change" : "input", debouncedSearch));
    ["work_rj_code", "work_title", "work_page_size"].forEach(id => el[id].addEventListener(id === "work_page_size" ? "change" : "input", () => { if (state.selectedCircle) { state.workPage = 1; loadWorks().catch(showWorkError); } }));
    setEditing(null);
    renderWorkPager();
    loadCircles().catch(showError);
  </script>
</body>
</html>`);
};