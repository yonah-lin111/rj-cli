import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
}

/** 编辑文件的结果 */
export interface EditFileResult {
  path: string;
  applied: number;
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
  try {
    await readFile(absolutePath);
  } catch {
    created = true;
  }
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
  return { path: absolutePath, created };
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
  let content = await readFile(absolutePath, "utf-8");

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
  return { path: absolutePath, applied: edits.length };
};
