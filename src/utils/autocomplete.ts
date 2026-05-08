import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";
import { CombinedAutocompleteProvider, fuzzyFilter } from "@mariozechner/pi-tui";

// --- gitignore 支持 ---

/** gitignore 规则 */
interface GitignoreRule {
  pattern: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

/**
 * 将 gitignore 模式字符串转换为正则表达式。
 */
const gitignorePatternToRegex = (pattern: string): RegExp => {
  // 去除未转义的尾部空格
  pattern = pattern.replace(/(?<!\\) +$/, "");

  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  // 不含斜杠的模式只匹配文件名
  const matchBasenameOnly = !pattern.includes("/");

  // 转义正则特殊字符，保留 * ? [
  let re = pattern.replace(/[.+^${}()|[\]\\]/g, (c) => (c === "\\" ? "\\\\" : `\\${c}`));

  // 将 glob 语法转为正则
  re = re
    .replace(/\*\*/g, "\x00") // 占位符替换 **
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\x00/g, ".*"); // ** 匹配任意路径

  if (matchBasenameOnly) {
    re = `(^|/)${re}(/|$)`;
  } else {
    if (!re.startsWith("/")) re = `^${re}`;
    else re = `^${re.slice(1)}`;
    re = `${re}(/|$)`;
  }

  return new RegExp(re);
};

/**
 * 解析 .gitignore 文件，返回规则列表。
 */
const parseGitignore = (gitignorePath: string): GitignoreRule[] => {
  try {
    const content = readFileSync(gitignorePath, "utf-8");
    const rules: GitignoreRule[] = [];
    for (const rawLine of content.split("\n")) {
      let line = rawLine;
      if (line.startsWith("#") || line.trim() === "") continue;
      const negated = line.startsWith("!");
      if (negated) line = line.slice(1);
      const dirOnly = line.endsWith("/");
      try {
        rules.push({ pattern: gitignorePatternToRegex(line), negated, dirOnly });
      } catch {
        // 跳过格式错误的规则
      }
    }
    return rules;
  } catch {
    return [];
  }
};

/**
 * 判断路径是否被 gitignore 规则忽略。
 */
const isIgnored = (relPath: string, isDirectory: boolean, rules: GitignoreRule[]): boolean => {
  const normalized = relPath.replace(/\\/g, "/");
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) continue;
    if (rule.pattern.test(normalized)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
};

/** gitignore 规则缓存，按目录存储，避免每次按键重复读取 */
const gitignoreCache = new Map<string, { rules: GitignoreRule[]; mtime: number }>();

/**
 * 获取指定仓库根目录的 gitignore 规则，结果按 mtime 缓存。
 */
const getGitignoreRules = (repoRoot: string): GitignoreRule[] => {
  const gitignorePath = join(repoRoot, ".gitignore");
  if (!existsSync(gitignorePath)) return [];
  try {
    const mtime = statSync(gitignorePath).mtimeMs;
    const cached = gitignoreCache.get(repoRoot);
    if (cached && cached.mtime === mtime) return cached.rules;
    const rules = parseGitignore(gitignorePath);
    gitignoreCache.set(repoRoot, { rules, mtime });
    return rules;
  } catch {
    return [];
  }
};

/**
 * 向上查找 .git 目录，返回仓库根路径，找不到返回 null。
 */
const findGitRoot = (startDir: string): string | null => {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

/** 路径分隔符集合，用于定位 token 起始位置 */
const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

/**
 * 从文本末尾向前查找最后一个路径分隔符的位置。
 */
const findLastDelimiter = (text: string): number => {
  for (let i = text.length - 1; i >= 0; i--) {
    if (PATH_DELIMITERS.has(text[i] ?? "")) return i;
  }
  return -1;
};

/**
 * 展开路径中的 ~ 为用户主目录。
 */
const expandHome = (p: string): string => {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
};

/**
 * 根据条目名称和前缀构建自动补全建议项。
 */
const buildSuggestion = (
  entryName: string,
  isDirectory: boolean,
  rawPrefix: string,
): AutocompleteItem => {
  let relativePath: string;
  if (rawPrefix.endsWith("/")) {
    relativePath = rawPrefix + entryName;
  } else if (rawPrefix.includes("/")) {
    if (rawPrefix.startsWith("~/")) {
      const homeRelDir = dirname(rawPrefix.slice(2));
      relativePath = `~/${homeRelDir === "." ? entryName : join(homeRelDir, entryName)}`;
    } else if (rawPrefix.startsWith("/")) {
      const dir2 = dirname(rawPrefix);
      relativePath = dir2 === "/" ? `/${entryName}` : `${dir2}/${entryName}`;
    } else {
      relativePath = join(dirname(rawPrefix), entryName);
      if (rawPrefix.startsWith("./") && !relativePath.startsWith("./")) {
        relativePath = `./${relativePath}`;
      }
    }
  } else {
    relativePath = rawPrefix.startsWith("~") ? `~/${entryName}` : entryName;
  }

  const pathValue = isDirectory ? `${relativePath}/` : relativePath;
  return {
    value: `@${pathValue}`,
    label: entryName + (isDirectory ? "/" : ""),
    description: relativePath,
  };
};

/**
 * 根据当前输入前缀列出文件系统建议，同时应用 gitignore 过滤。
 */
const getFileSuggestions = (rawPrefix: string, basePath: string): { items: AutocompleteItem[]; searchPrefix: string } => {
  try {
    const expanded = expandHome(rawPrefix);
    let searchDir: string;
    let searchPrefix: string;

    const isRoot =
      rawPrefix === "" || rawPrefix === "./" || rawPrefix === "../" ||
      rawPrefix === "~" || rawPrefix === "~/" || rawPrefix === "/";

    if (isRoot) {
      searchDir = expanded.startsWith("/") || expanded.startsWith("~")
        ? expanded || basePath
        : join(basePath, expanded || "");
      searchPrefix = "";
    } else if (rawPrefix.endsWith("/")) {
      searchDir = expanded.startsWith("/") ? expanded : join(basePath, expanded);
      searchPrefix = "";
    } else {
      const dir = dirname(expanded);
      const file = basename(expanded);
      searchDir = expanded.startsWith("/") ? dir : join(basePath, dir);
      searchPrefix = file;
    }

    const gitRoot = findGitRoot(searchDir);
    const ignoreRules = gitRoot ? getGitignoreRules(gitRoot) : [];

    const entries = readdirSync(searchDir, { withFileTypes: true });
    const items: AutocompleteItem[] = [];

    for (const entry of entries) {
      if (entry.name === ".git") continue;

      let isDirectory = entry.isDirectory();
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = statSync(join(searchDir, entry.name)).isDirectory();
        } catch { /* 忽略损坏的符号链接 */ }
      }

      if (gitRoot && ignoreRules.length > 0) {
        const absEntry = join(searchDir, entry.name);
        const relEntry = relative(gitRoot, absEntry).replace(/\\/g, "/");
        if (isIgnored(relEntry, isDirectory, ignoreRules)) continue;
      }

      if (isDirectory) {
        // 目录：同时展开一层子条目，方便快速选择
        const dirRawPrefix = (rawPrefix.endsWith("/") ? rawPrefix : rawPrefix.includes("/")
          ? dirname(rawPrefix) === "." ? "" : dirname(rawPrefix) + "/"
          : "") + entry.name + "/";
        const dirExpanded = expandHome(dirRawPrefix);
        const childDir = dirExpanded.startsWith("/") ? dirExpanded : join(basePath, dirExpanded);
        try {
          const childEntries = readdirSync(childDir, { withFileTypes: true });
          for (const child of childEntries) {
            if (child.name === ".git") continue;
            let childIsDir = child.isDirectory();
            if (!childIsDir && child.isSymbolicLink()) {
              try { childIsDir = statSync(join(childDir, child.name)).isDirectory(); } catch { /* */ }
            }
            if (gitRoot && ignoreRules.length > 0) {
              const absChild = join(childDir, child.name);
              const relChild = relative(gitRoot, absChild).replace(/\\/g, "/");
              if (isIgnored(relChild, childIsDir, ignoreRules)) continue;
            }
            items.push(buildSuggestion(child.name, childIsDir, dirRawPrefix));
          }
        } catch { /* 无法读取的目录跳过 */ }
        const dirParentPrefix = rawPrefix.endsWith("/") ? rawPrefix : rawPrefix.includes("/") ? dirname(rawPrefix) === "." ? "" : dirname(rawPrefix) + "/" : "";
        items.push(buildSuggestion(entry.name, true, dirParentPrefix));
      } else {
        items.push(buildSuggestion(entry.name, false, rawPrefix));
      }
    }

    return { items, searchPrefix };
  } catch {
    return { items: [], searchPrefix: "" };
  }
};

/**
 * 从光标前文本中提取 @ 前缀 token，不存在则返回 null。
 */
const extractAtPrefix = (text: string): string | null => {
  const lastDelim = findLastDelimiter(text);
  const tokenStart = lastDelim === -1 ? 0 : lastDelim + 1;
  if (text[tokenStart] === "@") return text.slice(tokenStart);
  return null;
};

/**
 * 封装 CombinedAutocompleteProvider，在其基础上增加 @ 文件路径补全能力。
 */
export class RJAutocompleteProvider implements AutocompleteProvider {
  private inner: CombinedAutocompleteProvider;
  private basePath: string;
  /** 记录上次补全来源，用于 applyCompletion 分支判断 */
  private lastCompletionSource: "at" | "inner" = "inner";

  constructor(
    commands: { name: string; description: string }[],
    basePath: string,
  ) {
    this.inner = new CombinedAutocompleteProvider(commands, basePath, null);
    this.basePath = basePath;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const currentLine = lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);

    const atPrefix = extractAtPrefix(textBeforeCursor);
    if (atPrefix !== null) {
      const rawPrefix = atPrefix.slice(1); // 去掉开头的 @
      const { items, searchPrefix } = getFileSuggestions(rawPrefix, this.basePath);
      const filtered = searchPrefix
        ? fuzzyFilter(items, searchPrefix, (item) => item.label.replace(/\/$/, ""))
        : items;
      filtered.sort((a, b) => {
        const aDir = a.label.endsWith("/");
        const bDir = b.label.endsWith("/");
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
      if (filtered.length === 0) return null;
      this.lastCompletionSource = "at";
      return { items: filtered, prefix: atPrefix };
    }

    // 委托给内置提供商处理斜杠命令和其他补全
    const result = await this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
    if (result) this.lastCompletionSource = "inner";
    return result;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    if (this.lastCompletionSource === "inner") {
      return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    }

    // @ 文件补全：直接替换当前行的前缀部分
    const currentLine = lines[cursorLine] ?? "";
    const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
    const afterCursor = currentLine.slice(cursorCol);
    const newLine = beforePrefix + item.value + afterCursor;
    const newLines = [...lines];
    newLines[cursorLine] = newLine;

    return {
      lines: newLines,
      cursorLine,
      cursorCol: beforePrefix.length + item.value.length,
    };
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    const currentLine = lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);
    // 斜杠命令不触发文件补全
    if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
      return false;
    }
    return true;
  }
}
