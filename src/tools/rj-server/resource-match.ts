import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { request } from "undici";
import { openDb, normalizeRjCode } from "./db.ts";

const MIAOWA_EXCEL_PATHS = [
  "/Users/yonah/.RJ/source/rj-data-miaowa.xlsx",
  "/Users/yonah/.RJ/source/rj-data-miaowa.xlsm",
  "/Users/yonah/.RJ/source/meage_source.xlsx",
  "/Users/yonah/.RJ/source/meage_source.xlsm",
] as const;

const ASMRONE_SEARCH_URL = "https://api.asmr-200.com/api/search";

export type ResourceMatchMode = "mega" | "asmrone";

export type ResourceMatchSelection =
  | { matchAll: true }
  | { matchAll: false; rjCode: string };

export interface ResourceMatchItem {
  rjCode: string;
  title: string | null;
  circle: string | null;
  exists: boolean;
  message?: string;
}

export interface ResourceMatchResult {
  mode: ResourceMatchMode;
  total: number;
  matched: number;
  unmatched: number;
  errors: number;
  items: ResourceMatchItem[];
  message?: string;
}

type LocalRjRow = {
  rj_code: string;
  title: string | null;
  circle: string | null;
};

type MegaExcelRow = {
  megaLink: string;
  title: string | null;
  circle: string | null;
};

type AsmrOneWork = {
  title?: string;
  name?: string;
  circle?: string;
  group?: string;
};

const optionalText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
};

const parseZipEntries = (buffer: Buffer): Map<string, Buffer> => {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileDataStart = fileNameEnd + extraFieldLength;
    const fileDataEnd = fileDataStart + compressedSize;
    const fileName = buffer.toString("utf8", fileNameStart, fileNameEnd);
    if (fileDataEnd > buffer.length) break;
    const compressed = buffer.subarray(fileDataStart, fileDataEnd);
    if (compressionMethod === 0) {
      entries.set(fileName, Buffer.from(compressed));
    } else if (compressionMethod === 8) {
      entries.set(fileName, inflateRawSync(compressed));
    } else {
      throw new Error(`不支持的 Excel 压缩格式: ${compressionMethod}`);
    }
    offset = fileDataEnd;
  }
  return entries;
};

const decodeXmlText = (value: string): string => value
  .replace(/&#(x?[0-9a-fA-F]+);/g, (_, entity: string) => {
    const codePoint = entity.toLowerCase().startsWith("x")
      ? Number.parseInt(entity.slice(1), 16)
      : Number.parseInt(entity, 10);
    return Number.isNaN(codePoint) ? _ : String.fromCodePoint(codePoint);
  })
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'");

const loadSharedStrings = (xml: string | undefined): string[] => {
  if (!xml) return [];
  const strings: string[] = [];
  const itemRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  for (const match of xml.matchAll(itemRegex)) {
    const fragment = match[1] ?? "";
    const text = [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((entry) => decodeXmlText(entry[1] ?? ""))
      .join("");
    strings.push(text);
  }
  return strings;
};

const columnRefToIndex = (ref: string): number => {
  let index = 0;
  for (const char of ref.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
};

const parseWorksheetRows = (xml: string, sharedStrings: string[]): string[][] => {
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  for (const rowMatch of xml.matchAll(rowRegex)) {
    const rowXml = rowMatch[1] ?? "";
    const row: string[] = [];
    for (const cellMatch of rowXml.matchAll(cellRegex)) {
      const attributes = cellMatch[1] ?? cellMatch[3] ?? "";
      const body = cellMatch[2] ?? "";
      const refMatch = attributes.match(/\br="([A-Z]+)\d+"/i);
      const index = refMatch ? columnRefToIndex(refMatch[1] ?? "A") : row.length;
      const typeMatch = attributes.match(/\bt="([^"]+)"/);
      const cellType = typeMatch?.[1];
      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = body.match(/<is>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      let value = "";
      if (cellType === "s") {
        const sharedIndex = Number(valueMatch?.[1] ?? "-1");
        value = sharedStrings[sharedIndex] ?? "";
      } else if (inlineMatch) {
        value = decodeXmlText(inlineMatch[1] ?? "");
      } else if (valueMatch) {
        value = decodeXmlText(valueMatch[1] ?? "");
      }
      row[index] = value;
    }
    rows.push(row.map((cell) => cell ?? ""));
  }
  return rows;
};

const loadMegaExcelMap = (): Map<string, MegaExcelRow> => {
  const excelPath = MIAOWA_EXCEL_PATHS.find((path) => {
    try {
      readFileSync(path);
      return true;
    } catch {
      return false;
    }
  });
  if (!excelPath) {
    throw new Error("未找到妙蛙Excel文件，请先上传");
  }

  const buffer = readFileSync(excelPath);
  const entries = parseZipEntries(buffer);
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  if (!workbookXml) {
    throw new Error("Excel工作表不存在");
  }
  const firstSheetMatch = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/);
  if (!firstSheetMatch?.[1]) {
    throw new Error("Excel工作表不存在");
  }

  const relsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relRegex = new RegExp(`<Relationship[^>]*(?:Id="${firstSheetMatch[1]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${firstSheetMatch[1]}")`, "i");
  const relMatch = relsXml.match(relRegex);
  const target = relMatch?.[1] ?? relMatch?.[2];
  if (!target) {
    throw new Error("Excel工作表不存在");
  }

  const worksheetPath = target.startsWith("/xl/")
    ? target.slice(1)
    : target.startsWith("xl/")
      ? target
      : `xl/${target.replace(/^\.?\//, "")}`;
  const worksheetXml = entries.get(worksheetPath)?.toString("utf8");
  if (!worksheetXml) {
    throw new Error("Excel工作表不存在");
  }

  const sharedStrings = loadSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const rows = parseWorksheetRows(worksheetXml, sharedStrings);
  const headerRow = rows[0];
  if (!headerRow || headerRow.every((cell) => !cell.trim())) {
    throw new Error("Excel内容为空");
  }

  const headerMap = new Map<string, number>();
  headerRow.forEach((value, index) => {
    const key = value.trim();
    if (key) headerMap.set(key, index);
  });

  const requiredHeaders = ["RJcode", "MEGA链接"];
  const missingHeaders = requiredHeaders.filter((name) => !headerMap.has(name));
  if (missingHeaders.length > 0) {
    throw new Error(`Excel缺少必要列: ${missingHeaders.join(", ")}`);
  }

  const titleIndex = headerMap.get("标题");
  const circleIndex = headerMap.get("社团");
  const rjIndex = headerMap.get("RJcode")!;
  const megaIndex = headerMap.get("MEGA链接")!;
  const result = new Map<string, MegaExcelRow>();
  for (const row of rows.slice(1)) {
    const rjCode = normalizeRjCode(row[rjIndex] ?? "");
    const megaLink = optionalText(row[megaIndex]);
    if (!rjCode || !megaLink) continue;
    result.set(rjCode, {
      megaLink,
      title: titleIndex === undefined ? null : optionalText(row[titleIndex]),
      circle: circleIndex === undefined ? null : optionalText(row[circleIndex]),
    });
  }
  return result;
};

const getBatchCandidates = (): LocalRjRow[] => {
  const db = openDb(true);
  try {
    return db.prepare(`
      SELECT rj_code, title, circle
      FROM rj
      WHERE status = 0 AND (source IS NULL OR TRIM(source) = '')
      ORDER BY id DESC
    `).all() as LocalRjRow[];
  } finally {
    db.close();
  }
};

const getLocalRjByCode = (rjCode: string): LocalRjRow | null => {
  const db = openDb(true);
  try {
    return db.prepare(`SELECT rj_code, title, circle FROM rj WHERE rj_code = ? LIMIT 1`).get(rjCode) as LocalRjRow | undefined ?? null;
  } finally {
    db.close();
  }
};

const getSelectionRows = (selection: ResourceMatchSelection): LocalRjRow[] => {
  if (selection.matchAll) return getBatchCandidates();
  const rjCode = normalizeRjCode(selection.rjCode);
  const local = getLocalRjByCode(rjCode);
  return [local ?? { rj_code: rjCode, title: null, circle: null }];
};

const buildResult = (mode: ResourceMatchMode, items: ResourceMatchItem[], message?: string): ResourceMatchResult => ({
  mode,
  total: items.length,
  matched: items.filter((item) => item.exists).length,
  unmatched: items.filter((item) => !item.exists && !item.message).length,
  errors: items.filter((item) => Boolean(item.message)).length,
  items,
  message,
});

export const matchMegaResources = (selection: ResourceMatchSelection): ResourceMatchResult => {
  const candidates = getSelectionRows(selection);
  if (selection.matchAll && candidates.length === 0) {
    return buildResult("mega", [], "没有符合条件的任务");
  }
  const excelMap = loadMegaExcelMap();
  const items = candidates.map((candidate) => {
    const row = excelMap.get(candidate.rj_code);
    return {
      rjCode: candidate.rj_code,
      title: candidate.title ?? row?.title ?? null,
      circle: candidate.circle ?? row?.circle ?? null,
      exists: Boolean(row),
      message: row ? `MEGA: ${row.megaLink}` : undefined,
    } satisfies ResourceMatchItem;
  });
  return buildResult("mega", items);
};

const fetchAsmroOneWork = async (rjCode: string): Promise<{ work: AsmrOneWork | null; worksCount: number }> => {
  const url = `${ASMRONE_SEARCH_URL}/${encodeURIComponent(rjCode)}?order=create_date&sort=desc&page=1&subtitle=0`;
  const response = await request(url, {
    method: "GET",
    headers: { accept: "application/json" },
    bodyTimeout: 10000,
    headersTimeout: 10000,
  });
  const payload = await response.body.json() as { works?: AsmrOneWork[] };
  const works = Array.isArray(payload.works) ? payload.works : [];
  return { work: works[0] ?? null, worksCount: works.length };
};

export const matchAsmroOneResources = async (selection: ResourceMatchSelection): Promise<ResourceMatchResult> => {
  const candidates = getSelectionRows(selection);
  if (selection.matchAll && candidates.length === 0) {
    return buildResult("asmrone", [], "没有符合条件的任务");
  }

  const items: ResourceMatchItem[] = [];
  for (const candidate of candidates) {
    try {
      const { work, worksCount } = await fetchAsmroOneWork(candidate.rj_code);
      items.push({
        rjCode: candidate.rj_code,
        title: candidate.title ?? optionalText(work?.title) ?? optionalText(work?.name),
        circle: candidate.circle ?? optionalText(work?.circle) ?? optionalText(work?.group),
        exists: Boolean(work),
        message: work ? `works: ${worksCount}` : undefined,
      });
    } catch (error) {
      items.push({
        rjCode: candidate.rj_code,
        title: candidate.title,
        circle: candidate.circle,
        exists: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return buildResult("asmrone", items);
};
