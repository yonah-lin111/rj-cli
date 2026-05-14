import { openDb, parseTags, serializeTags, normalizeRjCode } from "./db.ts";
import { cacheGet, cacheSet, rankingCacheKey } from "./cache.ts";
import { scrapeRanking, scrapeWorkDetail, scrapeCircleLatestWorks, type RankingType, type RankingItem } from "./scraper.ts";
import { matchMegaResources, matchAsmroOneResources, type ResourceMatchSelection, type ResourceMatchResult } from "./resource-match.ts";
import { parsePositiveInt, parseRankingType } from "../../app/rank-page.ts";

export interface RjServerToolResult {
  content: string;
  resultLabel: string;
  isError: boolean;
}

export type { ResourceMatchSelection, ResourceMatchResult };
export { matchMegaResources, matchAsmroOneResources };

// ── 排行榜 ──────────────────────────────────────────────────────────────────

export interface RankingArgs {
  ranking_type: RankingType;
  page?: number;
  page_size?: number;
  rj_code?: string;
  title?: string;
  circle?: string;
  cv?: string;
}

export const getRankingTool = async (args: RankingArgs): Promise<RjServerToolResult> => {
  const { ranking_type, page = 1, page_size = 20, rj_code, title, circle, cv } = args;
  try {
    const cacheKey = rankingCacheKey(ranking_type);
    let items = cacheGet(cacheKey) as RankingItem[] | null;

    if (!items || items.length === 0) {
      items = await scrapeRanking(ranking_type, 1);
      if (!items || items.length === 0) {
        return { content: `爬取排行榜失败，请检查网络: ${ranking_type}`, resultLabel: "error", isError: true };
      }
      cacheSet(cacheKey, items);
    }

    let filtered = items;
    if (rj_code) filtered = filtered.filter(i => i.rj_code.toUpperCase().includes(rj_code.toUpperCase()));
    if (title) filtered = filtered.filter(i => (i.title ?? "").toLowerCase().includes(title.toLowerCase()));
    if (circle) filtered = filtered.filter(i => (i.circle ?? "").toLowerCase().includes(circle.toLowerCase()));
    if (cv) filtered = filtered.filter(i => (i.cv ?? "").toLowerCase().includes(cv.toLowerCase()));

    const total = filtered.length;
    const start = (page - 1) * page_size;
    const paged = filtered.slice(start, start + page_size);

    return {
      content: JSON.stringify({ ranking_type, total, page, page_size, items: paged }, null, 2),
      resultLabel: `${ranking_type} 排行榜 (${total} 条)`,
      isError: false,
    };
  } catch (err) {
    return { content: `获取排行榜失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

// ── 本地 RJ / 社团管理 ───────────────────────────────────────────────────────

export interface AddRjFromRankingArgs {
  rj_code: string;
  ranking_type: RankingType;
  source?: string;
}

export interface RemoveRjArgs {
  rj_code: string;
}

export interface CheckRjExistsArgs {
  rj_codes: string[];
}

export interface AddCircleArgs {
  name: string;
  circle_url?: string;
  nickname?: string;
  remark?: string;
}

export interface RemoveCircleArgs {
  name: string;
}

export interface CheckCircleExistsArgs {
  names: string[];
}

export interface CircleQueryArgs {
  page?: number;
  page_size?: number;
  name?: string;
  nickname?: string;
  remark?: string;
}

export interface CircleDetailArgs {
  name: string;
}

export interface UpdateCircleArgs {
  name: string;
  nickname?: string;
  circle_url?: string | null;
  remark?: string | null;
}

export interface CircleWorksQueryArgs {
  circle_name: string;
  page?: number;
  page_size?: number;
  rj_code?: string;
  title?: string;
}

export interface CircleWorkArgs {
  circle_name: string;
  rj_code: string;
}

const optionalText = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const parseDownloadLinks = (value: unknown): unknown => {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const normalizeRjRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...row,
  tags: parseTags(row.tags),
  download_links: parseDownloadLinks(row.download_links),
});

const getCachedRankingItems = async (rankingType: RankingType): Promise<RankingItem[]> => {
  const cacheKey = rankingCacheKey(rankingType);
  let items = cacheGet(cacheKey) as RankingItem[] | null;
  if (!items || items.length === 0) {
    items = await scrapeRanking(rankingType, 1);
    if (items.length > 0) cacheSet(cacheKey, items);
  }
  return items ?? [];
};

const mergeRankingDetail = async (item: RankingItem): Promise<RankingItem> => {
  if (!item.title_url) return item;
  if (item.circle && item.circle_url && item.cv && item.tags.length > 0 && item.release_date) return item;
  const detail = await scrapeWorkDetail(item.title_url);
  return detail ? { ...item, ...detail, tags: detail.tags ?? item.tags } : item;
};

export const addRjFromRankingTool = async (args: AddRjFromRankingArgs): Promise<RjServerToolResult> => {
  try {
    const rjCode = normalizeRjCode(args.rj_code);
    const items = await getCachedRankingItems(args.ranking_type);
    const found = items.find(item => normalizeRjCode(item.rj_code) === rjCode);
    if (!found) {
      return { content: `排行榜缓存中未找到 RJ: ${rjCode}`, resultLabel: "not found", isError: true };
    }

    const item = await mergeRankingDetail(found);
    const db = openDb(false);
    const exists = db.prepare("SELECT 1 FROM rj WHERE rj_code = ?").get(rjCode);
    if (exists) {
      db.close();
      return { content: JSON.stringify({ rj_code: rjCode, added: false, exists: true }, null, 2), resultLabel: `RJ exists ${rjCode}`, isError: false };
    }

    db.prepare(`
      INSERT INTO rj (rj_code, title, title_url, circle, circle_url, cv, tags, is_all_ages, release_date, thumbnail, source, status)
      VALUES (@rj_code, @title, @title_url, @circle, @circle_url, @cv, @tags, @is_all_ages, @release_date, @thumbnail, @source, @status)
    `).run({
      rj_code: rjCode,
      title: item.title,
      title_url: item.title_url,
      circle: item.circle,
      circle_url: item.circle_url,
      cv: item.cv,
      tags: serializeTags(item.tags),
      is_all_ages: item.is_all_ages ? 1 : 0,
      release_date: item.release_date,
      thumbnail: item.thumbnail,
      source: args.source?.trim() || `ranking:${args.ranking_type}`,
      status: 0,
    });
    db.close();

    return { content: JSON.stringify({ rj_code: rjCode, added: true }, null, 2), resultLabel: `RJ added ${rjCode}`, isError: false };
  } catch (err) {
    return { content: `添加 RJ 失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const removeRjTool = (args: RemoveRjArgs): RjServerToolResult => {
  try {
    const rjCode = normalizeRjCode(args.rj_code);
    const db = openDb(false);
    const result = db.prepare("DELETE FROM rj WHERE rj_code = ?").run(rjCode);
    db.close();
    return { content: JSON.stringify({ rj_code: rjCode, removed: result.changes > 0 }, null, 2), resultLabel: `RJ removed ${rjCode}`, isError: false };
  } catch (err) {
    return { content: `删除 RJ 失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const updateRjStatusTool = (args: WorksUpdateStatusArgs): RjServerToolResult => {
  try {
    const rjCode = normalizeRjCode(args.rj_code);
    const status = parsePositiveInt(String(args.status), 0, 0, 2);
    const db = openDb(false);
    const exists = db.prepare("SELECT 1 FROM rj WHERE rj_code = ? LIMIT 1").get(rjCode);
    if (!exists) {
      db.close();
      return { content: `未找到 RJ: ${rjCode}`, resultLabel: "not found", isError: true };
    }
    const result = db.prepare("UPDATE rj SET status = ? WHERE rj_code = ?").run(status, rjCode);
    db.close();
    return {
      content: JSON.stringify({ rj_code: rjCode, status, updated: result.changes > 0 }, null, 2),
      resultLabel: `RJ status updated ${rjCode}`,
      isError: false,
    };
  } catch (err) {
    return { content: `更新 RJ 状态失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const checkRjExistsTool = (args: CheckRjExistsArgs): RjServerToolResult => {
  try {
    const codes = args.rj_codes.map(normalizeRjCode).filter(Boolean);
    const exists: Record<string, boolean> = {};
    for (const code of codes) exists[code] = false;
    if (codes.length > 0) {
      const placeholders = codes.map(() => "?").join(",");
      const db = openDb(true);
      const rows = db.prepare(`SELECT rj_code FROM rj WHERE rj_code IN (${placeholders})`).all(...codes) as { rj_code: string }[];
      db.close();
      for (const row of rows) exists[normalizeRjCode(row.rj_code)] = true;
    }
    return { content: JSON.stringify({ exists }, null, 2), resultLabel: `RJ exists ${codes.length}`, isError: false };
  } catch (err) {
    return { content: `检查 RJ 失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const addCircleTool = (args: AddCircleArgs): RjServerToolResult => {
  try {
    const name = args.name.trim();
    if (!name) return { content: "社团名不能为空", resultLabel: "error", isError: true };
    const db = openDb(false);
    const exists = db.prepare("SELECT 1 FROM circle WHERE name = ? LIMIT 1").get(name);
    if (exists) {
      db.close();
      return { content: JSON.stringify({ name, added: false, exists: true }, null, 2), resultLabel: `Circle exists ${name}`, isError: false };
    }
    db.prepare("INSERT INTO circle (name, nickname, circle_url, remark) VALUES (?, ?, ?, ?)")
      .run(name, args.nickname?.trim() || name, args.circle_url?.trim() || null, args.remark?.trim() || null);
    db.close();
    return { content: JSON.stringify({ name, added: true }, null, 2), resultLabel: `Circle added ${name}`, isError: false };
  } catch (err) {
    return { content: `添加社团失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const removeCircleTool = (args: RemoveCircleArgs): RjServerToolResult => {
  try {
    const name = args.name.trim();
    const db = openDb(false);
    const result = db.prepare("DELETE FROM circle WHERE name = ?").run(name);
    db.close();
    return { content: JSON.stringify({ name, removed: result.changes > 0 }, null, 2), resultLabel: `Circle removed ${name}`, isError: false };
  } catch (err) {
    return { content: `删除社团失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const checkCircleExistsTool = (args: CheckCircleExistsArgs): RjServerToolResult => {
  try {
    const names = args.names.map(name => name.trim()).filter(Boolean);
    const exists: Record<string, boolean> = {};
    for (const name of names) exists[name] = false;
    if (names.length > 0) {
      const placeholders = names.map(() => "?").join(",");
      const db = openDb(true);
      const rows = db.prepare(`SELECT name FROM circle WHERE name IN (${placeholders})`).all(...names) as { name: string }[];
      db.close();
      for (const row of rows) exists[row.name] = true;
    }
    return { content: JSON.stringify({ exists }, null, 2), resultLabel: `Circle exists ${names.length}`, isError: false };
  } catch (err) {
    return { content: `检查社团失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const queryCircleTool = (args: CircleQueryArgs): RjServerToolResult => {
  const { page = 1, page_size = 20, name, nickname, remark } = args;
  try {
    const db = openDb(true);
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (name) { conditions.push("name LIKE :name"); params.name = `%${name}%`; }
    if (nickname) { conditions.push("nickname LIKE :nickname"); params.nickname = `%${nickname}%`; }
    if (remark) { conditions.push("remark LIKE :remark"); params.remark = `%${remark}%`; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM circle ${where}`).get(params) as { cnt: number }).cnt;
    const pageSize = Math.min(100, Math.max(1, Math.floor(page_size)));
    const currentPage = Math.max(1, Math.floor(page));
    const offset = (currentPage - 1) * pageSize;
    const rows = db.prepare(`
      SELECT id, name, nickname, circle_url, remark, created_at,
        (SELECT COUNT(*) FROM rj WHERE rj.circle = circle.name) as work_count
      FROM circle ${where}
      ORDER BY id DESC
      LIMIT :limit OFFSET :offset
    `).all({ ...params, limit: pageSize, offset }) as Record<string, unknown>[];
    db.close();

    return {
      content: JSON.stringify({ total, page: currentPage, page_size: pageSize, data: rows }, null, 2),
      resultLabel: `社团查询 (${total} 条)`,
      isError: false,
    };
  } catch (err) {
    return { content: `查询社团失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const getCircleDetailTool = (args: CircleDetailArgs): RjServerToolResult => {
  try {
    const name = args.name.trim();
    if (!name) return { content: "社团名不能为空", resultLabel: "error", isError: true };
    const db = openDb(true);
    const row = db.prepare(`
      SELECT id, name, nickname, circle_url, remark, created_at,
        (SELECT COUNT(*) FROM rj WHERE rj.circle = circle.name) as work_count
      FROM circle
      WHERE name = ?
      LIMIT 1
    `).get(name) as Record<string, unknown> | undefined;
    db.close();
    if (!row) return { content: `未找到社团: ${name}`, resultLabel: "not found", isError: true };
    return { content: JSON.stringify(row, null, 2), resultLabel: `Circle ${name}`, isError: false };
  } catch (err) {
    return { content: `获取社团详情失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const updateCircleTool = (args: UpdateCircleArgs): RjServerToolResult => {
  try {
    const name = args.name.trim();
    if (!name) return { content: "社团名不能为空", resultLabel: "error", isError: true };
    const db = openDb(false);
    const exists = db.prepare("SELECT 1 FROM circle WHERE name = ? LIMIT 1").get(name);
    if (!exists) {
      db.close();
      return { content: `未找到社团: ${name}`, resultLabel: "not found", isError: true };
    }
    const nickname = args.nickname?.trim() || name;
    const result = db.prepare("UPDATE circle SET nickname = ?, circle_url = ?, remark = ? WHERE name = ?")
      .run(nickname, optionalText(args.circle_url), optionalText(args.remark), name);
    db.close();
    return { content: JSON.stringify({ name, updated: result.changes > 0 }, null, 2), resultLabel: `Circle updated ${name}`, isError: false };
  } catch (err) {
    return { content: `更新社团失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const queryCircleWorksTool = (args: CircleWorksQueryArgs): RjServerToolResult => {
  const { circle_name, page = 1, page_size = 20, rj_code, title } = args;
  try {
    const circleName = circle_name.trim();
    if (!circleName) return { content: "社团名不能为空", resultLabel: "error", isError: true };
    const db = openDb(true);
    const conditions = ["circle = :circle_name"];
    const params: Record<string, unknown> = { circle_name: circleName };
    if (rj_code) { conditions.push("rj_code LIKE :rj_code"); params.rj_code = `%${rj_code}%`; }
    if (title) { conditions.push("title LIKE :title"); params.title = `%${title}%`; }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM rj ${where}`).get(params) as { cnt: number }).cnt;
    const pageSize = Math.min(100, Math.max(1, Math.floor(page_size)));
    const currentPage = Math.max(1, Math.floor(page));
    const offset = (currentPage - 1) * pageSize;
    const rows = db.prepare(`SELECT * FROM rj ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`)
      .all({ ...params, limit: pageSize, offset }) as Record<string, unknown>[];
    db.close();
    const data = rows.map(normalizeRjRow);
    return {
      content: JSON.stringify({ circle_name: circleName, total, page: currentPage, page_size: pageSize, data }, null, 2),
      resultLabel: `社团作品查询 (${total} 条)`,
      isError: false,
    };
  } catch (err) {
    return { content: `查询社团作品失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const addWorkToCircleTool = (args: CircleWorkArgs): RjServerToolResult => {
  try {
    const circleName = args.circle_name.trim();
    const rjCode = normalizeRjCode(args.rj_code);
    if (!circleName) return { content: "社团名不能为空", resultLabel: "error", isError: true };
    const db = openDb(false);
    const circle = db.prepare("SELECT circle_url FROM circle WHERE name = ? LIMIT 1").get(circleName) as { circle_url: string | null } | undefined;
    if (!circle) {
      db.close();
      return { content: `未找到社团: ${circleName}`, resultLabel: "not found", isError: true };
    }
    const work = db.prepare("SELECT circle_url FROM rj WHERE rj_code = ? LIMIT 1").get(rjCode) as { circle_url: string | null } | undefined;
    if (!work) {
      db.close();
      return { content: `未找到 RJ: ${rjCode}`, resultLabel: "not found", isError: true };
    }
    db.prepare("UPDATE rj SET circle = ?, circle_url = ? WHERE rj_code = ?")
      .run(circleName, circle.circle_url || work.circle_url || null, rjCode);
    db.close();
    return { content: JSON.stringify({ circle_name: circleName, rj_code: rjCode, added: true }, null, 2), resultLabel: `Circle work added ${rjCode}`, isError: false };
  } catch (err) {
    return { content: `添加社团作品失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export const removeWorkFromCircleTool = (args: CircleWorkArgs): RjServerToolResult => {
  try {
    const circleName = args.circle_name.trim();
    const rjCode = normalizeRjCode(args.rj_code);
    if (!circleName) return { content: "社团名不能为空", resultLabel: "error", isError: true };
    const db = openDb(false);
    const result = db.prepare("UPDATE rj SET circle = NULL, circle_url = NULL WHERE rj_code = ? AND circle = ?")
      .run(rjCode, circleName);
    db.close();
    return { content: JSON.stringify({ circle_name: circleName, rj_code: rjCode, removed: result.changes > 0 }, null, 2), resultLabel: `Circle work removed ${rjCode}`, isError: false };
  } catch (err) {
    return { content: `移除社团作品失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

// ── 社团最新发布作品（爬取） ──────────────────────────────────────────────────

export interface CircleLatestWorksArgs {
  circle_name: string;
  limit?: number;
}

export const getCircleLatestWorksTool = async (args: CircleLatestWorksArgs): Promise<RjServerToolResult> => {
  try {
    const circleName = args.circle_name.trim();
    const limit = Math.min(20, Math.max(1, args.limit ?? 10));
    if (!circleName) return { content: "社团名不能为空", resultLabel: "error", isError: true };

    const db = openDb(true);
    const row = db.prepare("SELECT circle_url FROM circle WHERE name = ?").get(circleName) as { circle_url: string | null } | undefined;
    db.close();

    if (!row) return { content: `社团 "${circleName}" 不存在`, resultLabel: "error", isError: true };
    if (!row.circle_url) return { content: `社团 "${circleName}" 未设置 circle_url，无法爬取最新作品`, resultLabel: "error", isError: true };

    const items = await scrapeCircleLatestWorks(row.circle_url, limit);
    return {
      content: JSON.stringify({ circle_name: circleName, circle_url: row.circle_url, total: items.length, items }, null, 2),
      resultLabel: `${circleName} 最新 ${items.length} 部作品`,
      isError: false,
    };
  } catch (err) {
    return { content: `爬取社团最新作品失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

export interface AddRjFromLatestWorkArgs {
  rj_code: string;
  title: string;
  title_url: string | null;
  thumbnail: string | null;
  release_date: string | null;
  is_all_ages: boolean;
  circle_name: string;
}

export const addRjFromLatestWorkTool = async (args: AddRjFromLatestWorkArgs): Promise<RjServerToolResult> => {
  try {
    const rjCode = normalizeRjCode(args.rj_code);
    if (!rjCode) return { content: "RJ号不能为空", resultLabel: "error", isError: true };

    const db = openDb(false);
    const exists = db.prepare("SELECT 1 FROM rj WHERE rj_code = ?").get(rjCode);
    if (exists) {
      db.close();
      return { content: JSON.stringify({ rj_code: rjCode, added: false, exists: true }, null, 2), resultLabel: `RJ exists ${rjCode}`, isError: false };
    }

    const circleRow = db.prepare("SELECT circle_url FROM circle WHERE name = ? LIMIT 1").get(args.circle_name) as { circle_url: string | null } | undefined;

    let detail: Partial<{ circle: string; circle_url: string | null; cv: string | null; tags: string[]; is_all_ages: boolean }> = {
      circle: args.circle_name,
      circle_url: circleRow?.circle_url ?? null,
      cv: null,
      tags: [],
      is_all_ages: args.is_all_ages,
    };

    if (args.title_url) {
      const scraped = await scrapeWorkDetail(args.title_url);
      if (scraped) {
        detail = {
          circle: scraped.circle ?? args.circle_name,
          circle_url: scraped.circle_url ?? circleRow?.circle_url ?? null,
          cv: scraped.cv ?? null,
          tags: scraped.tags ?? [],
          is_all_ages: scraped.is_all_ages ?? args.is_all_ages,
        };
      }
    }

    db.prepare(`
      INSERT INTO rj (rj_code, title, title_url, circle, circle_url, cv, tags, is_all_ages, release_date, thumbnail, source, status)
      VALUES (@rj_code, @title, @title_url, @circle, @circle_url, @cv, @tags, @is_all_ages, @release_date, @thumbnail, @source, @status)
    `).run({
      rj_code: rjCode,
      title: args.title,
      title_url: args.title_url,
      circle: detail.circle,
      circle_url: detail.circle_url,
      cv: detail.cv,
      tags: serializeTags(detail.tags ?? []),
      is_all_ages: detail.is_all_ages ? 1 : 0,
      release_date: args.release_date,
      thumbnail: args.thumbnail,
      source: "circle:latest",
      status: 0,
    });
    db.close();

    return { content: JSON.stringify({ rj_code: rjCode, added: true }, null, 2), resultLabel: `RJ added ${rjCode}`, isError: false };
  } catch (err) {
    return { content: `入库失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

// ── 本地 RJ 查询 ─────────────────────────────────────────────────────────────

export interface RjQueryArgs {
  page?: number;
  page_size?: number;
  rj_code?: string;
  title?: string;
  circle?: string;
  cv?: string;
  source?: string;
  status?: number;
  release_date_start?: string;
  release_date_end?: string;
  created_at_start?: string;
  created_at_end?: string;
}

export interface WorksListArgs {
  preset?: "all" | "latest-added" | "latest-undownloaded";
  page?: number;
  page_size?: number;
  circle?: string;
  rj_code?: string;
  title?: string;
  source?: string;
  status?: number;
}

export interface WorksDeleteArgs {
  rj_code: string;
}

export interface WorksUpdateStatusArgs {
  rj_code: string;
  status: number;
}

export interface RankListArgs {
  ranking_type?: string | null;
  page?: number;
  page_size?: number;
  rj_code?: string;
  title?: string;
  circle?: string;
  cv?: string;
}

export interface RankWorkArgs {
  ranking_type?: string | null;
  rj_code: string;
  source?: string;
}

export interface RankCircleArgs {
  name: string;
  circle_url?: string;
  nickname?: string;
  remark?: string;
}

export interface CircleLatestWorkAddArgs extends AddRjFromLatestWorkArgs {}

export const worksListTool = (args: WorksListArgs): RjServerToolResult => {
  const preset = args.preset === "latest-added" || args.preset === "latest-undownloaded" ? args.preset : "all";
  const status = args.status === undefined
    ? (preset === "latest-undownloaded" ? 0 : undefined)
    : parsePositiveInt(String(args.status), 0, 0, 2);
  return queryRjTool({
    page: args.page,
    page_size: args.page_size,
    rj_code: args.rj_code,
    title: args.title,
    circle: args.circle,
    source: args.source,
    status,
  });
};

export const worksDeleteTool = (args: WorksDeleteArgs): RjServerToolResult => removeRjTool(args);

export const worksUpdateStatusTool = (args: WorksUpdateStatusArgs): RjServerToolResult => updateRjStatusTool(args);

export const circleListTool = (args: CircleQueryArgs): RjServerToolResult => queryCircleTool(args);

export const circleGetTool = (args: CircleDetailArgs): RjServerToolResult => getCircleDetailTool(args);

export const circleDeleteTool = (args: RemoveCircleArgs): RjServerToolResult => removeCircleTool(args);

export const circleWorksListTool = (args: CircleWorksQueryArgs): RjServerToolResult => queryCircleWorksTool(args);

export const circleWorkRemoveTool = (args: CircleWorkArgs): RjServerToolResult => removeWorkFromCircleTool(args);

export const circleLatestWorksListTool = async (args: CircleLatestWorksArgs): Promise<RjServerToolResult> => getCircleLatestWorksTool(args);

export const circleLatestWorkAddTool = async (args: CircleLatestWorkAddArgs): Promise<RjServerToolResult> => addRjFromLatestWorkTool(args);

export const rankListTool = async (args: RankListArgs): Promise<RjServerToolResult> => getRankingTool({
  ranking_type: parseRankingType(args.ranking_type ?? null),
  page: args.page,
  page_size: args.page_size,
  rj_code: args.rj_code,
  title: args.title,
  circle: args.circle,
  cv: args.cv,
});

export const rankAddWorkTool = async (args: RankWorkArgs): Promise<RjServerToolResult> => addRjFromRankingTool({
  ranking_type: parseRankingType(args.ranking_type ?? null),
  rj_code: args.rj_code,
  source: args.source,
});

export const rankRemoveWorkTool = (args: RemoveRjArgs): RjServerToolResult => removeRjTool(args);

export const rankAddCircleTool = (args: RankCircleArgs): RjServerToolResult => addCircleTool(args);

export const rankRemoveCircleTool = (args: RemoveCircleArgs): RjServerToolResult => removeCircleTool(args);

export const queryRjTool = (args: RjQueryArgs): RjServerToolResult => {
  const { page = 1, page_size = 20, rj_code, title, circle, cv, source, status,
    release_date_start, release_date_end, created_at_start, created_at_end } = args;
  try {
    const db = openDb(true);
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (rj_code) { conditions.push("rj_code LIKE :rj_code"); params.rj_code = `%${rj_code}%`; }
    if (title) { conditions.push("title LIKE :title"); params.title = `%${title}%`; }
    if (circle) { conditions.push("circle LIKE :circle"); params.circle = `%${circle}%`; }
    if (cv) { conditions.push("cv LIKE :cv"); params.cv = `%${cv}%`; }
    if (source !== undefined) { conditions.push("source = :source"); params.source = source; }
    if (status !== undefined) { conditions.push("status = :status"); params.status = status; }
    if (release_date_start) { conditions.push("release_date >= :rds"); params.rds = release_date_start; }
    if (release_date_end) { conditions.push("release_date <= :rde"); params.rde = release_date_end; }
    if (created_at_start) { conditions.push("date(created_at) >= :cas"); params.cas = created_at_start; }
    if (created_at_end) { conditions.push("date(created_at) <= :cae"); params.cae = created_at_end; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM rj ${where}`).get(params) as { cnt: number }).cnt;
    const offset = (page - 1) * page_size;
    const rows = db.prepare(`SELECT * FROM rj ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`)
      .all({ ...params, limit: page_size, offset }) as Record<string, unknown>[];
    db.close();

    const data = rows.map(normalizeRjRow);
    return {
      content: JSON.stringify({ total, page, page_size, data }, null, 2),
      resultLabel: `RJ 查询 (${total} 条)`,
      isError: false,
    };
  } catch (err) {
    return { content: `查询 RJ 失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

// ── RJ 详情 ──────────────────────────────────────────────────────────────────

export interface RjDetailArgs {
  rj_code: string;
}

export const getRjDetailTool = (args: RjDetailArgs): RjServerToolResult => {
  try {
    const db = openDb(true);
    const row = db.prepare("SELECT * FROM rj WHERE rj_code = ?").get(args.rj_code) as Record<string, unknown> | undefined;
    db.close();
    if (!row) {
      return { content: `未找到 RJ: ${args.rj_code}`, resultLabel: "not found", isError: true };
    }
    return {
      content: JSON.stringify(normalizeRjRow(row), null, 2),
      resultLabel: args.rj_code,
      isError: false,
    };
  } catch (err) {
    return { content: `获取 RJ 详情失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};

// ── 数据概览 ─────────────────────────────────────────────────────────────────

export const getOverviewTool = (): RjServerToolResult => {
  try {
    const db = openDb(true);

    const totalRj = (db.prepare("SELECT COUNT(*) as cnt FROM rj").get() as { cnt: number }).cnt;
    const totalCircle = (db.prepare("SELECT COUNT(*) as cnt FROM circle").get() as { cnt: number }).cnt;

    const statusRows = db.prepare("SELECT status, COUNT(*) as cnt FROM rj GROUP BY status").all() as { status: number; cnt: number }[];
    const statusMap: Record<number, number> = {};
    for (const r of statusRows) statusMap[r.status] = r.cnt;

    const allAgesCount = (db.prepare("SELECT COUNT(*) as cnt FROM rj WHERE is_all_ages = 1").get() as { cnt: number }).cnt;

    const sourceRows = db.prepare("SELECT source, COUNT(*) as cnt FROM rj GROUP BY source").all() as { source: string | null; cnt: number }[];
    const sourceDistribution = sourceRows.map(r => ({ name: r.source ?? "未设置", value: r.cnt }));

    const topCircleRows = db.prepare(
      "SELECT circle, COUNT(*) as cnt FROM rj WHERE circle IS NOT NULL AND circle != '' GROUP BY circle ORDER BY cnt DESC LIMIT 8"
    ).all() as { circle: string; cnt: number }[];
    const topCircles = topCircleRows.map(r => ({ circle: r.circle, work_count: r.cnt }));

    const noSourceCount = (db.prepare("SELECT COUNT(*) as cnt FROM rj WHERE source IS NULL").get() as { cnt: number }).cnt;
    const noCircleCount = (db.prepare("SELECT COUNT(*) as cnt FROM rj WHERE circle IS NULL").get() as { cnt: number }).cnt;

    db.close();

    const pending = statusMap[0] ?? 0;
    const downloaded = statusMap[1] ?? 0;
    const deleted = statusMap[2] ?? 0;

    const result = {
      summary: {
        total_rj: totalRj,
        total_circle: totalCircle,
        pending_count: pending,
        downloaded_count: downloaded,
        deleted_count: deleted,
        all_ages_ratio: totalRj > 0 ? Math.round((allAgesCount / totalRj) * 10000) / 10000 : 0,
      },
      status_distribution: [
        { name: "未下载", value: pending },
        { name: "已下载", value: downloaded },
        { name: "已删除", value: deleted },
      ],
      source_distribution: sourceDistribution,
      top_circles: topCircles,
      action_board: [
        { key: "pending-download", title: "待下载任务", count: pending },
        { key: "missing-source", title: "待补来源", count: noSourceCount },
        { key: "missing-circle", title: "待补社团", count: noCircleCount },
      ],
    };

    return { content: JSON.stringify(result, null, 2), resultLabel: "overview", isError: false };
  } catch (err) {
    return { content: `获取数据概览失败: ${err instanceof Error ? err.message : String(err)}`, resultLabel: "error", isError: true };
  }
};
