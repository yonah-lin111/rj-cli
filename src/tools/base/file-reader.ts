import { execFileSync } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, resolve } from "node:path";
import type { RJFileReadingConfig } from "../../core/config.ts";

/** 匹配 Unicode 非标准空格字符 */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * 将 Unicode 非标准空格替换为普通空格。
 */
const normalizeUnicodeSpaces = (str: string): string =>
  str.replace(UNICODE_SPACES, " ");

/**
 * 展开路径中的 ~ 为用户主目录。
 */
const expandPath = (filePath: string): string => {
  const normalized = normalizeUnicodeSpaces(filePath);
  if (normalized === "~") return homedir();
  if (normalized.startsWith("~/")) return homedir() + normalized.slice(1);
  return normalized;
};

/**
 * 将文件路径解析为绝对路径，相对路径基于 cwd 解析。
 */
const resolveFilePath = (filePath: string, cwd: string): string => {
  const expanded = expandPath(filePath);
  if (isAbsolute(expanded)) return expanded;
  return resolve(cwd, expanded);
};

/**
 * 检查文件是否可访问。
 */
const fileExists = (filePath: string): boolean => {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const listDirectoryWithNode = (dirPath: string, maxEntries: number): string => {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const sorted = entries
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  const limited = sorted.slice(0, maxEntries);
  const lines = limited.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  if (sorted.length > maxEntries) {
    lines.push(`... (${sorted.length - maxEntries} more entries)`);
  }
  return lines.join("\n");
};

const listDirectoryWithBash = (dirPath: string, maxEntries: number): string => {
  const stdout = execFileSync("/bin/ls", ["-1Ap", dirPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const lines = stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= maxEntries) return lines.join("\n");
  return [...lines.slice(0, maxEntries), `... (${lines.length - maxEntries} more entries)`].join("\n");
};

/**
 * 列出目录内容，优先使用 bash，失败时回退到 Node 方案。
 */
const listDirectory = (dirPath: string, maxEntries: number): string => {
  try {
    return listDirectoryWithBash(dirPath, maxEntries);
  } catch {
    try {
      return listDirectoryWithNode(dirPath, maxEntries);
    } catch {
      return "(unable to read directory)";
    }
  }
};

const isAllowedFile = (filePath: string, allowedExts: string[]): boolean => {
  if (allowedExts.length === 0) return true;
  return allowedExts.includes(extname(filePath));
};

/** @ 引用解析结果 */
export interface AtMention {
  /** 原始 token，如 "@src/app.ts" */
  raw: string;
  /** 解析后的绝对路径 */
  path: string;
  isDirectory: boolean;
  exists: boolean;
}

/**
 * 从用户输入中提取所有 @mention 和裸文件路径。
 * 支持 @path、@"path with spaces"、/absolute/path、./relative 等格式。
 */
export const extractAtMentions = (text: string, cwd: string): AtMention[] => {
  const mentions: AtMention[] = [];
  const pattern = /@"([^"]+)"|@(\S+)|((?:\/|\.\.?\/)\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const rawToken = match[0];
    const pathPart = match[1] ?? match[2] ?? match[3] ?? "";
    if (!pathPart) continue;

    const absPath = resolveFilePath(pathPart, cwd);
    const exists = fileExists(absPath);
    // 裸路径（非 @ 前缀）不存在时跳过，避免误匹配
    if (!exists && match[3]) continue;
    let isDirectory = false;
    if (exists) {
      try {
        isDirectory = statSync(absPath).isDirectory();
      } catch {
        // ignore
      }
    }

    mentions.push({ raw: rawToken, path: absPath, isDirectory, exists });
  }

  return mentions;
};

/**
 * 将文本中的 @mention 替换为 <file> 块（文件内容或目录列表）。
 * 返回展开后的文本和警告信息列表。
 */
export const expandAtMentions = (
  text: string,
  cwd: string,
  config?: RJFileReadingConfig,
): { expanded: string; warnings: string[] } => {
  const mentions = extractAtMentions(text, cwd);
  if (mentions.length === 0) return { expanded: text, warnings: [] };

  const maxSize = config?.maxFileSizeBytes ?? 1048576;
  const maxEntries = config?.maxDirectoryEntries ?? 200;
  const allowedExts = config?.allowedExtensions ?? [];

  const warnings: string[] = [];
  let result = text;

  for (const mention of mentions) {
    if (!mention.exists) {
      warnings.push(`File not found: ${mention.path}`);
      continue;
    }

    let block: string;
    try {
      const stats = statSync(mention.path);
      if (stats.isDirectory()) {
        const listing = listDirectory(mention.path, maxEntries);
        block = `<file name="${mention.path}" type="directory">\n${listing}\n</file>`;
      } else {
        if (!isAllowedFile(mention.path, allowedExts)) {
          const ext = extname(mention.path);
          warnings.push(`Skipped ${mention.path}: extension ${ext || "(none)"} not in allowedExtensions`);
          continue;
        }
        if (stats.size > maxSize) {
          warnings.push(`Skipped ${mention.path}: file size ${stats.size} exceeds maxFileSizeBytes ${maxSize}`);
          continue;
        }
        const content = readFileSync(mention.path, "utf-8");
        block = `<file name="${mention.path}">\n${content}\n</file>`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not read ${mention.path}: ${msg}`);
      continue;
    }

    result = result.replace(mention.raw, block);
  }

  return { expanded: result, warnings };
};

/**
 * 列出 cwd 下的文件和目录，用于 @ 裸触发时的提示展示。
 */
export const listCwd = (cwd: string): string => listDirectory(cwd, 200);
