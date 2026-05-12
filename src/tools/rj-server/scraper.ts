import { parse, HTMLElement } from "node-html-parser";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export type RankingType = "24h" | "7d" | "30d" | "year";

const RANKING_PATH: Record<RankingType, string> = {
  "24h": "day",
  "7d": "week",
  "30d": "month",
  "year": "year",
};

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

const getProxyUrl = (): string | undefined =>
  process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.ALL_PROXY ?? "http://127.0.0.1:7890";

const proxyFetch = async (url: string): Promise<Response> => {
  const proxyUrl = getProxyUrl();
  if (proxyUrl) {
    const dispatcher = new ProxyAgent(proxyUrl);
    return undiciFetch(url, { headers: HEADERS, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }
  return fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
};

export interface RankingItem {
  rank: number | null;
  rj_code: string;
  title: string;
  title_url: string | null;
  thumbnail: string | null;
  circle: string | null;
  circle_url: string | null;
  cv: string | null;
  tags: string[];
  is_all_ages: boolean;
  release_date: string | null;
}

const buildThumbnailUrl = (rjCode: string): string => {
  const num = parseInt(rjCode.replace("RJ", ""), 10);
  const folder = (Math.floor(num / 1000) + 1) * 1000;
  const folderStr = num >= 1_000_000 ? `RJ${String(folder).padStart(8, "0")}` : `RJ${folder}`;
  return `https://img.dlsite.jp/resize/images2/work/doujin/${folderStr}/${rjCode}_img_main_240x240.jpg`;
};

const fetchPage = async (rankingType: RankingType, page: number): Promise<string | null> => {
  const path = RANKING_PATH[rankingType];
  let url = `https://www.dlsite.com/maniax/ranking/${path}?category=voice&date=30d&locale=ja_JP`;
  if (page > 1) url += `&page=${page}`;
  try {
    const res = await proxyFetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

const parseItem = (row: HTMLElement): RankingItem | null => {
  try {
    const item: Partial<RankingItem> = { tags: [], is_all_ages: false };

    // 排名
    const rankNo = row.querySelector(".rank_no");
    item.rank = rankNo ? parseInt(rankNo.text.trim(), 10) || null : null;

    // 标题 & RJ号
    const titleLink = row.querySelector("dt.work_name a");
    if (!titleLink) return null;
    item.title = titleLink.text.trim();
    const href = titleLink.getAttribute("href") ?? "";
    const rjMatch = href.match(/RJ\d+/);
    if (!rjMatch) return null;
    item.rj_code = rjMatch[0];
    item.title_url = href ? (href.startsWith("/") ? `https://www.dlsite.com${href}` : href) : null;
    item.thumbnail = buildThumbnailUrl(item.rj_code);

    // 社团 & CV
    const makerName = row.querySelector("dd.maker_name");
    if (makerName) {
      const circleLink = makerName.querySelector("a:not([href*='keyword_creater'])");
      if (circleLink) {
        item.circle = circleLink.text.trim();
        const ch = circleLink.getAttribute("href") ?? "";
        item.circle_url = ch ? (ch.startsWith("/") ? `https://www.dlsite.com${ch}` : ch) : null;
      } else {
        item.circle = null;
        item.circle_url = null;
      }
      const cvLinks = makerName.querySelectorAll("a[href*='keyword_creater']");
      item.cv = cvLinks.length > 0 ? cvLinks.map((a: HTMLElement) => a.text.trim()).join("、") : null;
    }

    // 标签
    const tagLinks = row.querySelectorAll("dd.search_tag a");
    item.tags = tagLinks.map((a: HTMLElement) => a.text.trim()).filter(Boolean);

    // 全年龄
    item.is_all_ages = !!row.querySelector("span.icon_GEN");

    // 发售日
    const salesDate = row.querySelector("li.sales_date");
    if (salesDate) {
      item.release_date = salesDate.text.replace("販売日:", "").trim() || null;
    } else {
      item.release_date = null;
    }

    return item as RankingItem;
  } catch {
    return null;
  }
};

export const scrapeRanking = async (rankingType: RankingType, maxPages = 1): Promise<RankingItem[]> => {
  const all: RankingItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchPage(rankingType, page);
    if (!html) continue;
    const root = parse(html);
    const tbody = root.querySelector("table#ranking_table tbody");
    if (!tbody) continue;
    const rows = tbody.querySelectorAll("tr");
    for (const row of rows) {
      const item = parseItem(row);
      if (item) all.push(item);
    }
    if (page < maxPages) await new Promise(r => setTimeout(r, 2000));
  }
  return all;
};

export interface CircleWorkItem {
  rj_code: string;
  title: string;
  title_url: string | null;
  thumbnail: string | null;
  release_date: string | null;
  is_all_ages: boolean;
}

export const scrapeCircleLatestWorks = async (circleUrl: string, limit = 10): Promise<CircleWorkItem[]> => {
  try {
    const rgMatch = circleUrl.match(/maker_id[=/]+(RG\d+)/i);
    if (!rgMatch) return [];
    const rgId = rgMatch[1];
    const searchUrl = `https://www.dlsite.com/maniax/fsr/=/language/jp/sex_category[0]/male/work_category[0]/doujin/order[0]/release_d/options_and_or/and/maker_id/${rgId}/per_page/${limit}/page/1/show_type/1.html`;
    const res = await proxyFetch(searchUrl);
    if (!res.ok) return [];
    const html = await res.text();
    const root = parse(html);
    const items: CircleWorkItem[] = [];
    const rows = root.querySelectorAll("table.work_1col_table tr");
    for (const row of rows) {
      if (items.length >= limit) break;
      const rjCode = row.getAttribute("data-list_item_product_id");
      if (!rjCode) continue;
      const titleLink = row.querySelector("dt.work_name a");
      if (!titleLink) continue;
      const href = titleLink.getAttribute("href") ?? "";
      const titleUrl = href ? (href.startsWith("/") ? `https://www.dlsite.com${href}` : href) : null;
      const salesDateEl = row.querySelector("li.sales_date");
      let releaseDate: string | null = null;
      if (salesDateEl) {
        const m = salesDateEl.text.match(/(\d{4})年(\d{2})月(\d{2})日/);
        if (m) releaseDate = `${m[1]}/${m[2]}/${m[3]}`;
      }
      const isAllAges = !!row.querySelector("span.icon_GEN");
      items.push({
        rj_code: rjCode,
        title: titleLink.text.trim(),
        title_url: titleUrl,
        thumbnail: buildThumbnailUrl(rjCode),
        release_date: releaseDate,
        is_all_ages: isAllAges,
      });
    }
    return items;
  } catch {
    return [];
  }
};

export const scrapeWorkDetail = async (workUrl: string): Promise<Partial<RankingItem> | null> => {
  try {
    const res = await proxyFetch(workUrl);
    if (!res.ok) return null;
    const html = await res.text();
    const root = parse(html);
    const info: Partial<RankingItem> = { tags: [], is_all_ages: false };

    const rjMatch = workUrl.match(/RJ\d+/);
    if (rjMatch) {
      info.rj_code = rjMatch[0];
      info.thumbnail = buildThumbnailUrl(rjMatch[0]);
    }

    const titleEl = root.querySelector("h1#work_name");
    if (titleEl) info.title = titleEl.text.trim();
    info.title_url = workUrl;

    const rows = root.querySelectorAll("table tr");
    for (const row of rows) {
      const th = row.querySelector("th");
      const td = row.querySelector("td");
      if (!th || !td) continue;
      const key = th.text.trim();

      if (key.includes("サークル名")) {
        const a = td.querySelector("a");
        if (a) {
          info.circle = a.text.trim();
          const ch = a.getAttribute("href") ?? "";
          info.circle_url = ch ? (ch.startsWith("/") ? `https://www.dlsite.com${ch}` : ch) : null;
        }
      }
      if (key.includes("声優")) {
        const cvLinks = td.querySelectorAll("a[href*='keyword_creater']");
        if (cvLinks.length > 0) info.cv = cvLinks.map((a: HTMLElement) => a.text.trim()).join("、");
      }
      if (key.includes("販売日")) {
        const m = td.text.match(/(\d{4})年(\d{2})月(\d{2})日/);
        if (m) info.release_date = `${m[1]}/${m[2]}/${m[3]}`;
      }
      if (key.includes("ジャンル")) {
        info.tags = td.querySelectorAll("a").map((a: HTMLElement) => a.text.trim()).filter(Boolean);
      }
    }

    return info;
  } catch {
    return null;
  }
};
