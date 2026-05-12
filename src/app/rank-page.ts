import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getRankingTool } from "../tools/rj-server/index.ts";
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
  if (url.pathname === "/api/ranking") {
    await sendRankPageData(url, res);
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

export const parseRankingType = (value: string | null): RankSelection["rankingType"] => {
  if (value === "7d" || value === "30d" || value === "year") return value;
  return "24h";
};

export const parsePositiveInt = (value: string | null, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
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
    .summary { margin: 8px 0 12px; color: var(--muted); font-size: 13px; }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: 1120px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
    th { position: sticky; top: 0; background: #111827; color: #cbd5e1; white-space: nowrap; }
    tr:hover td { background: rgba(56, 189, 248, .06); }
    a { color: var(--accent); text-decoration: none; }
    .thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; background: #020617; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; max-width: 260px; }
    .tag { padding: 2px 6px; border-radius: 999px; background: #1e293b; color: #cbd5e1; font-size: 12px; }
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
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>排名</th><th>封面</th><th>RJ号</th><th>标题</th><th>社团</th><th>CV</th><th>标签</th><th>全年龄</th><th>发售日</th></tr>
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
    const state = { page: 1, total: 0 };
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
      renderRows(data.items || []);
      renderPager();
      document.getElementById("summary").textContent = data.ranking_type + " 排行榜，共 " + state.total + " 条";
    }

    function renderRows(items) {
      const tbody = document.getElementById("rows");
      tbody.innerHTML = items.map(item => '<tr>' +
        '<td>' + escapeHtml(item.rank ?? "-") + '</td>' +
        '<td>' + (item.thumbnail ? '<img class="thumb" src="' + escapeHtml(item.thumbnail) + '" loading="lazy">' : '') + '</td>' +
        '<td>' + escapeHtml(item.rj_code) + '</td>' +
        '<td>' + link(item.title_url, item.title) + '</td>' +
        '<td>' + link(item.circle_url, item.circle || "") + '</td>' +
        '<td>' + escapeHtml(item.cv || "") + '</td>' +
        '<td><div class="tags">' + (item.tags || []).map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div></td>' +
        '<td>' + (item.is_all_ages ? '是' : '否') + '</td>' +
        '<td>' + escapeHtml(item.release_date || "") + '</td>' +
      '</tr>').join('');
      if (!items.length) tbody.innerHTML = '<tr><td colspan="9">暂无数据</td></tr>';
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

    document.getElementById("search").onclick = () => { state.page = 1; loadRanking().catch(showError); };
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
    ids.forEach(id => el[id].addEventListener(id === "page_size" || id === "ranking_type" ? "change" : "input", debouncedSearch));
    loadRanking().catch(showError);
  </script>
</body>
</html>`);
};