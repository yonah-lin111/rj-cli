import { openDb, parseTags, serializeTags, normalizeRjCode } from "./db.ts";
import { cacheGet, cacheSet, rankingCacheKey } from "./cache.ts";
import { scrapeRanking, scrapeWorkDetail, type RankingType, type RankingItem } from "./scraper.ts";

export interface RjServerToolResult {
  content: string;
  resultLabel: string;
  isError: boolean;
}

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

    const data = rows.map(r => ({ ...r, tags: parseTags(r.tags) }));
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
      content: JSON.stringify({ ...row, tags: parseTags(row.tags) }, null, 2),
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
