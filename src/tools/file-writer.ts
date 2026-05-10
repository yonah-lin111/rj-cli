import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { diffLines } from "diff";

/** 读取文件的结果 */
export interface ReadFileResult {
  path: string;
  content: string;
}

/**
 * 读取文件内容，返回 UTF-8 字符串。
 */
export const readFileTool = async (
  path: string,
  cwd: string,
): Promise<ReadFileResult> => {
  const absolutePath = resolve(cwd, path);
  const content = await readFile(absolutePath, "utf-8");
  return { path: absolutePath, content };
};

/** 写入文件的结果 */
export interface WriteFileResult {
  path: string;
  created: boolean;
  diff?: string;
}

/** 编辑文件的结果 */
export interface EditFileResult {
  path: string;
  applied: number;
  diff?: string;
}

/** 单条编辑操作：将 oldText 替换为 newText */
export interface FileEdit {
  oldText: string;
  newText: string;
}

/**
 * 创建或覆盖写入文件，自动创建父目录。
 */
export const writeFileTool = async (
  path: string,
  content: string,
  cwd: string,
): Promise<WriteFileResult> => {
  const absolutePath = resolve(cwd, path);
  let created = false;
  let oldContent = "";
  try {
    oldContent = await readFile(absolutePath, "utf-8");
  } catch {
    created = true;
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
  const diff = created ? undefined : buildDiff(oldContent, content);
  return { path: absolutePath, created, diff };
};

/**
 * 对文件执行一组精确字符串替换。
 * 每条 edit 的 oldText 必须在文件中唯一出现，否则抛出错误。
 */
export const editFileTool = async (
  path: string,
  edits: FileEdit[],
  cwd: string,
): Promise<EditFileResult> => {
  const absolutePath = resolve(cwd, path);
  const original = await readFile(absolutePath, "utf-8");
  let content = original;

  for (const edit of edits) {
    const count = content.split(edit.oldText).length - 1;
    if (count === 0) {
      throw new Error(`edit_file: oldText not found in ${path}:\n${edit.oldText}`);
    }
    if (count > 1) {
      throw new Error(
        `edit_file: oldText matches ${count} times in ${path}, must be unique:\n${edit.oldText}`,
      );
    }
    content = content.replace(edit.oldText, edit.newText);
  }

  await writeFile(absolutePath, content, "utf-8");
  return { path: absolutePath, applied: edits.length, diff: buildDiff(original, content) };
};

/**
 * 用 diffLines 生成简洁的 +/- diff 字符串，仅包含变更行及上下各 2 行上下文。
 * 超出上下文范围的连续未变更行用 @@ 省略。
 */
function buildDiff(oldContent: string, newContent: string): string | undefined {
  const CONTEXT = 2;
  const changes = diffLines(oldContent, newContent);
  const hasChanges = changes.some((c) => c.added || c.removed);
  if (!hasChanges) return undefined;

  // 展开为带前缀的行数组
  type DiffLine = { prefix: "+" | "-" | " "; text: string };
  const flat: DiffLine[] = [];
  for (const change of changes) {
    const prefix = change.added ? "+" : change.removed ? "-" : " ";
    const text = change.value.replace(/\n$/, "");
    for (const line of text.split("\n")) {
      flat.push({ prefix, text: line });
    }
  }

  // 标记需要显示的行（变更行 ± CONTEXT）
  const show = new Array<boolean>(flat.length).fill(false);
  for (let i = 0; i < flat.length; i++) {
    if (flat[i]!.prefix !== " ") {
      for (let j = Math.max(0, i - CONTEXT); j <= Math.min(flat.length - 1, i + CONTEXT); j++) {
        show[j] = true;
      }
    }
  }

  // 组装输出，连续隐藏行用 @@ 替代
  const output: string[] = [];
  let i = 0;
  while (i < flat.length) {
    if (show[i]) {
      output.push(`${flat[i]!.prefix}${flat[i]!.text}`);
      i++;
    } else {
      let skip = 0;
      while (i < flat.length && !show[i]) { skip++; i++; }
      output.push(`@@ -${skip} lines @@`);
    }
  }
  return output.join("\n");
}
