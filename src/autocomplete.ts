import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";
import { CombinedAutocompleteProvider, fuzzyFilter } from "@mariozechner/pi-tui";

// --- gitignore support ---

interface GitignoreRule {
  pattern: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

function gitignorePatternToRegex(pattern: string): RegExp {
  // Strip trailing spaces (unless escaped)
  pattern = pattern.replace(/(?<!\\) +$/, "");

  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  // If pattern contains no slash (except trailing, already removed), match basename only
  const matchBasenameOnly = !pattern.includes("/");

  // Escape regex special chars except * ? and [
  let re = pattern.replace(/[.+^${}()|[\]\\]/g, (c) => (c === "\\" ? "\\\\" : `\\${c}`));

  // Convert glob to regex
  re = re
    .replace(/\*\*/g, "\x00") // placeholder for **
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\x00/g, ".*"); // ** matches anything including /

  if (matchBasenameOnly) {
    re = `(^|/)${re}(/|$)`;
  } else {
    // Anchored to root of the repo
    if (!re.startsWith("/")) re = `^${re}`;
    else re = `^${re.slice(1)}`;
    re = `${re}(/|$)`;
  }

  return new RegExp(re);
}

function parseGitignore(gitignorePath: string): GitignoreRule[] {
  try {
    const content = readFileSync(gitignorePath, "utf-8");
    const rules: GitignoreRule[] = [];
    for (const rawLine of content.split("\n")) {
      let line = rawLine;
      // Skip comments and empty lines
      if (line.startsWith("#") || line.trim() === "") continue;
      const negated = line.startsWith("!");
      if (negated) line = line.slice(1);
      const dirOnly = line.endsWith("/");
      try {
        rules.push({ pattern: gitignorePatternToRegex(line), negated, dirOnly });
      } catch {
        // skip malformed patterns
      }
    }
    return rules;
  } catch {
    return [];
  }
}

function isIgnored(relPath: string, isDirectory: boolean, rules: GitignoreRule[]): boolean {
  // Normalize to forward slashes
  const normalized = relPath.replace(/\\/g, "/");
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDirectory) continue;
    if (rule.pattern.test(normalized)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

// Cache gitignore rules per directory to avoid re-reading on every keystroke
const gitignoreCache = new Map<string, { rules: GitignoreRule[]; mtime: number }>();

function getGitignoreRules(repoRoot: string): GitignoreRule[] {
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
}

function findGitRoot(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

function findLastDelimiter(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (PATH_DELIMITERS.has(text[i] ?? "")) return i;
  }
  return -1;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

function buildSuggestion(
  entryName: string,
  isDirectory: boolean,
  rawPrefix: string,
): AutocompleteItem {
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
}

function getFileSuggestions(rawPrefix: string, basePath: string): { items: AutocompleteItem[]; searchPrefix: string } {
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
        } catch { /* broken symlink */ }
      }

      if (gitRoot && ignoreRules.length > 0) {
        const absEntry = join(searchDir, entry.name);
        const relEntry = relative(gitRoot, absEntry).replace(/\\/g, "/");
        if (isIgnored(relEntry, isDirectory, ignoreRules)) continue;
      }

      if (isDirectory) {
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
        } catch { /* unreadable dir */ }
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
}

function extractAtPrefix(text: string): string | null {
  const lastDelim = findLastDelimiter(text);
  const tokenStart = lastDelim === -1 ? 0 : lastDelim + 1;
  if (text[tokenStart] === "@") return text.slice(tokenStart);
  return null;
}

/**
 * Wraps CombinedAutocompleteProvider and adds @ file completion fallback
 * using readdirSync when fd is not available.
 */
export class RJAutocompleteProvider implements AutocompleteProvider {
  private inner: CombinedAutocompleteProvider;
  private basePath: string;
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
      const rawPrefix = atPrefix.slice(1); // strip leading @
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

    // Delegate slash commands and other completions to inner provider
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

    // @ file completion
    const currentLine = lines[cursorLine] ?? "";
    const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
    const afterCursor = currentLine.slice(cursorCol);
    const isDirectory = item.label.endsWith("/");
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
    if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
      return false;
    }
    return true;
  }
}
