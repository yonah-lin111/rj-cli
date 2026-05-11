import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { openDb } from "./db.ts";

const execFileAsync = promisify(execFile);

// ── 常量 ──────────────────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = new Set([".wav", ".flac", ".mp3"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
const COVER_SIZE = { w: 666, h: 500 };

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface AudioFileInfo {
  filename: string;
  format: string;
  size_mb: number;
}

export interface SubFolderInfo {
  name: string;
  audio_files: AudioFileInfo[];
  image_files: string[];
  other_items: string[];
}

export interface WorkOpsPreviewResult {
  success: boolean;
  message: string;
  rj_code?: string;
  title?: string;
  cv?: string;
  cv_folder_name?: string;
  audio_files: AudioFileInfo[];
  image_files: string[];
  cover_image?: string;
  other_items: string[];
  output_path_preview?: string;
  sub_folders: SubFolderInfo[];
}

export interface WorkOpsProgressEvent {
  step: string;
  message: string;
  progress?: number;
  total?: number;
  output_path?: string;
  total_files?: number;
  success_count?: number;
  error_count?: number;
  errors?: string[];
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function extractRjCode(folderName: string): string | null {
  const match = folderName.match(/RJ(\d+)/i);
  return match ? `RJ${match[1].toUpperCase()}` : null;
}

function getCvFolderName(cv: string | null | undefined): string {
  if (!cv) return "unknown";
  const cvList = cv.split(/[,，/、]/).map((c) => c.trim()).filter(Boolean);
  if (cvList.length > 1) return "dp";
  return cvList[0] ?? "unknown";
}

interface ScanResult {
  audio_files: string[];
  image_files: string[];
  other_items: string[];
}

function scanDirectory(dirPath: string): ScanResult {
  const audio_files: string[] = [];
  const image_files: string[] = [];
  const other_items: string[] = [];

  const entries = readdirSync(dirPath).sort();
  for (const name of entries) {
    const fullPath = join(dirPath, name);
    const stat = statSync(fullPath);
    if (stat.isFile()) {
      const ext = extname(name).toLowerCase();
      if (AUDIO_EXTENSIONS.has(ext)) audio_files.push(name);
      else if (IMAGE_EXTENSIONS.has(ext)) image_files.push(name);
      else other_items.push(name);
    } else if (stat.isDirectory()) {
      other_items.push(name);
    }
  }
  return { audio_files, image_files, other_items };
}

interface SubFolderScan {
  name: string;
  path: string;
  audio_files: string[];
  image_files: string[];
  other_items: string[];
}

function scanDirectoryMulti(dirPath: string): {
  sub_folders: SubFolderScan[];
  root_images: string[];
  root_audio: string[];
  root_others: string[];
} {
  const sub_folders: SubFolderScan[] = [];
  const root_images: string[] = [];
  const root_audio: string[] = [];
  const root_others: string[] = [];

  const entries = readdirSync(dirPath).sort();
  for (const name of entries) {
    const fullPath = join(dirPath, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const inner = scanDirectory(fullPath);
      sub_folders.push({ name, path: fullPath, ...inner });
    } else if (stat.isFile()) {
      const ext = extname(name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) root_images.push(name);
      else if (AUDIO_EXTENSIONS.has(ext)) root_audio.push(name);
      else root_others.push(name);
    }
  }
  return { sub_folders, root_images, root_audio, root_others };
}

function selectCover(imageFiles: string[], coverName?: string): string | null {
  if (imageFiles.length === 0) return null;
  if (coverName && imageFiles.includes(coverName)) return coverName;
  for (const img of imageFiles) {
    const stem = basename(img, extname(img)).toLowerCase();
    if (stem === "cover" || stem === "1") return img;
  }
  return imageFiles[0] ?? null;
}

async function prepareCover(coverPath: string, workDir: string): Promise<string | null> {
  const resized = join(workDir, "cover_resized.jpg");
  const { w, h } = COVER_SIZE;
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", coverPath,
      "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "-q:v", "2", resized,
    ]);
    return resized;
  } catch {
    return null;
  }
}

async function convertSingle(
  audioPath: string,
  targetFormat: string,
  outputDir: string,
  title: string,
  album: string,
  artist: string,
  coverPath: string | null,
): Promise<{ ok: boolean; msg: string }> {
  const stem = basename(audioPath, extname(audioPath));
  const srcExt = extname(audioPath).toLowerCase();
  const outFile = join(outputDir, `${stem}.${targetFormat}`);

  const validConversions = new Set([".wav|flac", ".wav|mp3", ".flac|mp3"]);
  const isSameFormat = srcExt === `.${targetFormat}`;

  if (!isSameFormat && !validConversions.has(`${srcExt}|${targetFormat}`)) {
    return { ok: false, msg: `不支持 ${srcExt} → ${targetFormat}` };
  }

  try {
    const cmd: string[] = ["-y", "-i", audioPath];

    if (coverPath && existsSync(coverPath)) {
      cmd.push("-i", coverPath, "-map", "0:a", "-map", "1:v", "-disposition:v", "attached_pic", "-metadata:s:v", "comment=Cover (front)");
    }

    if (isSameFormat) {
      if (targetFormat === "mp3") cmd.push("-c:a", "copy", "-c:v", "copy", "-id3v2_version", "3");
      else cmd.push("-c", "copy");
    } else if (targetFormat === "flac") {
      cmd.push("-c:a", "flac");
    } else if (targetFormat === "mp3") {
      cmd.push("-c:a", "libmp3lame", "-q:a", "0", "-id3v2_version", "3");
    }

    if (coverPath && existsSync(coverPath) && !isSameFormat) {
      cmd.push("-c:v", "copy");
    }

    cmd.push("-metadata", `title=${title}`, "-metadata", `album=${album}`, "-metadata", `artist=${artist}`, outFile);

    await execFileAsync("ffmpeg", cmd, { timeout: 600_000 });
    return { ok: true, msg: `转换成功: ${stem}` };
  } catch (e) {
    return { ok: false, msg: `转换失败: ${stem} - ${e instanceof Error ? e.message : String(e)}` };
  }
}

function copySingle(audioPath: string, outputDir: string): { ok: boolean; msg: string } {
  const name = basename(audioPath);
  const dst = join(outputDir, name);
  try {
    copyFileSync(audioPath, dst);
    return { ok: true, msg: `复制成功: ${name}` };
  } catch (e) {
    return { ok: false, msg: `复制失败: ${name} - ${e instanceof Error ? e.message : String(e)}` };
  }
}

function isDirEmpty(dirPath: string): boolean {
  try {
    return readdirSync(dirPath).length === 0;
  } catch {
    return true;
  }
}

// ── preview ───────────────────────────────────────────────────────────────────

export interface WorkOpsPreviewArgs {
  source_path: string;
  target_format: string;
  output_base_path?: string;
  multi_folder?: boolean;
}

export const previewWorkOps = (args: WorkOpsPreviewArgs): WorkOpsPreviewResult => {
  const { source_path, target_format, output_base_path = "", multi_folder = false } = args;

  if (!existsSync(source_path) || !statSync(source_path).isDirectory()) {
    return { success: false, message: `路径不存在或不是文件夹: ${source_path}`, audio_files: [], image_files: [], other_items: [], sub_folders: [] };
  }

  const folderName = basename(source_path);
  const rj_code = extractRjCode(folderName);
  if (!rj_code) {
    return { success: false, message: `无法从文件夹名提取RJ号: ${folderName}`, audio_files: [], image_files: [], other_items: [], sub_folders: [] };
  }

  const db = openDb(true);
  const row = db.prepare("SELECT * FROM rj WHERE rj_code = ?").get(rj_code) as Record<string, unknown> | undefined;
  db.close();

  if (!row) {
    return { success: false, message: `数据库中未找到 ${rj_code}`, audio_files: [], image_files: [], other_items: [], sub_folders: [] };
  }

  const title = String(row.title ?? "");
  const cv = row.cv != null ? String(row.cv) : null;
  const cv_folder_name = getCvFolderName(cv);
  const base = output_base_path || join(source_path, "..");
  const output_path_preview = basename(base) === cv_folder_name
    ? join(base, title)
    : join(base, cv_folder_name, title);

  if (multi_folder) {
    const { sub_folders, root_images, root_audio, root_others } = scanDirectoryMulti(source_path);
    const cover_image = selectCover(root_images);
    return {
      success: true,
      message: "预览成功（多文件夹模式）",
      rj_code,
      title,
      cv: cv ?? undefined,
      cv_folder_name,
      audio_files: root_audio.map((f) => {
        const s = statSync(join(source_path, f));
        return { filename: f, format: extname(f).slice(1), size_mb: Math.round(s.size / 1024 / 1024 * 100) / 100 };
      }),
      image_files: root_images,
      cover_image: cover_image ?? undefined,
      other_items: root_others,
      output_path_preview,
      sub_folders: sub_folders.map((sf) => ({
        name: sf.name,
        audio_files: sf.audio_files.map((f) => {
          const s = statSync(join(sf.path, f));
          return { filename: f, format: extname(f).slice(1), size_mb: Math.round(s.size / 1024 / 1024 * 100) / 100 };
        }),
        image_files: sf.image_files,
        other_items: sf.other_items,
      })),
    };
  }

  const { audio_files, image_files, other_items } = scanDirectory(source_path);
  const cover_image = selectCover(image_files);

  return {
    success: true,
    message: "预览成功",
    rj_code,
    title,
    cv: cv ?? undefined,
    cv_folder_name,
    audio_files: audio_files.map((f) => {
      const s = statSync(join(source_path, f));
      return { filename: f, format: extname(f).slice(1), size_mb: Math.round(s.size / 1024 / 1024 * 100) / 100 };
    }),
    image_files,
    cover_image: cover_image ?? undefined,
    other_items,
    output_path_preview,
    sub_folders: [],
  };
};

// ── process ───────────────────────────────────────────────────────────────────

export interface WorkOpsProcessArgs {
  source_path: string;
  target_format: string;
  keep_source: boolean;
  threads: number;
  output_base_path: string;
  force_overwrite?: boolean;
  multi_folder?: boolean;
  selected_folders?: string[];
  cover_image?: string;
}

export async function* processWorkOps(args: WorkOpsProcessArgs): AsyncGenerator<WorkOpsProgressEvent> {
  const {
    source_path, target_format, keep_source, threads, output_base_path,
    force_overwrite = false, multi_folder = false, selected_folders = [], cover_image,
  } = args;

  yield { step: "validate", message: "验证路径和数据..." };

  if (!existsSync(source_path) || !statSync(source_path).isDirectory()) {
    yield { step: "error", message: `路径不存在: ${source_path}` };
    return;
  }

  const folderName = basename(source_path);
  const rj_code = extractRjCode(folderName);
  if (!rj_code) {
    yield { step: "error", message: `无法提取RJ号: ${folderName}` };
    return;
  }

  const db = openDb(true);
  const row = db.prepare("SELECT * FROM rj WHERE rj_code = ?").get(rj_code) as Record<string, unknown> | undefined;
  db.close();

  if (!row) {
    yield { step: "error", message: `数据库未找到: ${rj_code}` };
    return;
  }

  const title = String(row.title ?? "");
  const cv = row.cv != null ? String(row.cv) : null;
  yield { step: "validate", message: `找到作品: ${title} | CV: ${cv ?? "未知"}` };

  if (multi_folder) {
    yield* processMulti(source_path, title, cv, target_format, keep_source, threads, output_base_path, force_overwrite, selected_folders, cover_image);
  } else {
    yield* processSingleFolder(source_path, title, cv, target_format, keep_source, threads, output_base_path, force_overwrite, cover_image);
  }
}

async function* processSingleFolder(
  source_path: string,
  title: string,
  cv: string | null,
  target_format: string,
  keep_source: boolean,
  threads: number,
  output_base_path: string,
  force_overwrite: boolean,
  cover_image?: string,
): AsyncGenerator<WorkOpsProgressEvent> {
  yield { step: "scan", message: "扫描文件..." };
  const { audio_files, image_files, other_items } = scanDirectory(source_path);

  if (audio_files.length === 0) {
    yield { step: "error", message: "未找到音频文件" };
    return;
  }
  yield { step: "scan", message: `找到 ${audio_files.length} 个音频, ${image_files.length} 张图片` };

  // 封面
  let cover_path: string | null = null;
  if (target_format !== "none") {
    const cover = selectCover(image_files, cover_image);
    if (cover) {
      yield { step: "cover", message: `处理封面: ${cover}` };
      cover_path = await prepareCover(join(source_path, cover), source_path);
      yield { step: "cover", message: cover_path ? "封面处理完成" : "封面处理失败，继续无封面转换" };
    } else {
      yield { step: "cover", message: "未找到图片，跳过封面设置" };
    }
  } else {
    yield { step: "cover", message: "跳过封面处理（无格式转换）" };
  }

  // 输出目录
  const cv_folder = getCvFolderName(cv);
  const base = output_base_path || join(source_path, "..");
  const output_dir = basename(base) === cv_folder
    ? join(base, title)
    : join(base, cv_folder, title);
  const image_dir = join(output_dir, "image");

  if (existsSync(output_dir) && !isDirEmpty(output_dir)) {
    if (!force_overwrite) {
      yield { step: "confirm_overwrite", message: `输出目录已存在且不为空: ${output_dir}`, output_path: output_dir };
      return;
    }
    yield { step: "mkdir", message: `覆盖已有目录: ${output_dir}` };
    rmSync(output_dir, { recursive: true, force: true });
  }

  mkdirSync(output_dir, { recursive: true });
  mkdirSync(image_dir, { recursive: true });
  yield { step: "mkdir", message: `输出目录: ${output_dir}` };

  // 转换 / 复制
  const errors: string[] = [];
  const album = title;
  const artist = cv ?? "";

  if (target_format === "none") {
    yield { step: "convert", message: "复制音频文件（无格式转换）...", progress: 0, total: audio_files.length };
    for (let i = 0; i < audio_files.length; i++) {
      const af = audio_files[i]!;
      const r = copySingle(join(source_path, af), output_dir);
      if (!r.ok) errors.push(r.msg);
      yield { step: "convert", message: r.msg, progress: i + 1, total: audio_files.length };
    }
  } else {
    yield { step: "convert", message: "开始格式转换...", progress: 0, total: audio_files.length };
    let completed = 0;

    // 分批并发，每批 threads 个
    for (let i = 0; i < audio_files.length; i += threads) {
      const batch = audio_files.slice(i, i + threads);
      const results = await Promise.all(
        batch.map((af) => convertSingle(join(source_path, af), target_format, output_dir, basename(af, extname(af)), album, artist, cover_path))
      );
      for (const r of results) {
        completed++;
        if (!r.ok) errors.push(r.msg);
        yield { step: "convert", message: r.msg, progress: completed, total: audio_files.length };
      }
    }
  }

  // 整理图片
  yield { step: "relocate", message: "整理文件位置..." };
  for (const img of image_files) {
    const dst = join(image_dir, img);
    if (!existsSync(dst)) copyFileSync(join(source_path, img), dst);
  }
  for (const item of other_items) {
    const src = join(source_path, item);
    const dst = join(output_dir, item);
    if (!existsSync(dst)) {
      if (statSync(src).isDirectory()) {
        mkdirSync(dst, { recursive: true });
      } else {
        copyFileSync(src, dst);
      }
    }
  }
  yield { step: "relocate", message: "文件整理完成" };

  // 清理临时封面
  const temp_cover = join(source_path, "cover_resized.jpg");
  if (existsSync(temp_cover)) rmSync(temp_cover);

  // 删除源文件
  if (!keep_source) {
    yield { step: "cleanup", message: "删除源文件..." };
    try {
      rmSync(source_path, { recursive: true, force: true });
      yield { step: "cleanup", message: "源文件已删除" };
    } catch (e) {
      yield { step: "cleanup", message: `删除源文件失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    yield { step: "cleanup", message: "保留源文件" };
  }

  yield {
    step: "done",
    message: "处理完成",
    output_path: output_dir,
    total_files: audio_files.length,
    success_count: audio_files.length - errors.length,
    error_count: errors.length,
    errors,
  };
}

async function* processMulti(
  source_path: string,
  title: string,
  cv: string | null,
  target_format: string,
  keep_source: boolean,
  threads: number,
  output_base_path: string,
  force_overwrite: boolean,
  selected_folders: string[],
  cover_image?: string,
): AsyncGenerator<WorkOpsProgressEvent> {
  yield { step: "scan", message: "扫描子文件夹..." };
  const { sub_folders, root_images, root_audio, root_others } = scanDirectoryMulti(source_path);

  const selected_subs = sub_folders.filter((sf) => selected_folders.includes(sf.name));
  const unselected_subs = sub_folders.filter((sf) => !selected_folders.includes(sf.name));

  const total_audio = selected_subs.reduce((s, sf) => s + sf.audio_files.length, 0) + root_audio.length;
  if (total_audio === 0 && selected_subs.length === 0) {
    yield { step: "error", message: "未选择任何子文件夹且无根级别音频" };
    return;
  }
  yield { step: "scan", message: `选中 ${selected_subs.length} 个文件夹, 共 ${total_audio} 个音频` };

  // 封面
  let cover_path: string | null = null;
  if (target_format !== "none") {
    const all_images = [...root_images, ...selected_subs.flatMap((sf) => sf.image_files)];
    const cover = selectCover(all_images, cover_image);
    if (cover) {
      yield { step: "cover", message: `处理封面: ${cover}` };
      const coverFullPath = existsSync(join(source_path, cover)) ? join(source_path, cover) : join(selected_subs[0]?.path ?? source_path, cover);
      cover_path = await prepareCover(coverFullPath, source_path);
      yield { step: "cover", message: cover_path ? "封面处理完成" : "封面处理失败，继续无封面转换" };
    } else {
      yield { step: "cover", message: "未找到图片，跳过封面设置" };
    }
  } else {
    yield { step: "cover", message: "跳过封面处理（无格式转换）" };
  }

  // 输出目录
  const cv_folder = getCvFolderName(cv);
  const base = output_base_path || join(source_path, "..");
  const output_dir = basename(base) === cv_folder
    ? join(base, title)
    : join(base, cv_folder, title);
  const image_dir = join(output_dir, "image");

  if (existsSync(output_dir) && !isDirEmpty(output_dir)) {
    if (!force_overwrite) {
      yield { step: "confirm_overwrite", message: `输出目录已存在且不为空: ${output_dir}`, output_path: output_dir };
      return;
    }
    yield { step: "mkdir", message: `覆盖已有目录: ${output_dir}` };
    rmSync(output_dir, { recursive: true, force: true });
  }

  mkdirSync(output_dir, { recursive: true });
  mkdirSync(image_dir, { recursive: true });
  yield { step: "mkdir", message: `输出目录: ${output_dir}` };

  const errors: string[] = [];
  let completed = 0;
  const album = title;
  const artist = cv ?? "";

  // 处理各子文件夹
  for (const sf of selected_subs) {
    const sub_output = join(output_dir, sf.name);
    mkdirSync(sub_output, { recursive: true });

    if (target_format === "none") {
      yield { step: "convert", message: `[${sf.name}] 复制音频文件...`, progress: completed, total: total_audio };
      for (const af of sf.audio_files) {
        const r = copySingle(join(sf.path, af), sub_output);
        completed++;
        if (!r.ok) errors.push(r.msg);
        yield { step: "convert", message: `[${sf.name}] ${r.msg}`, progress: completed, total: total_audio };
      }
    } else {
      yield { step: "convert", message: `[${sf.name}] 开始转换...`, progress: completed, total: total_audio };
      for (let i = 0; i < sf.audio_files.length; i += threads) {
        const batch = sf.audio_files.slice(i, i + threads);
        const results = await Promise.all(
          batch.map((af) => convertSingle(join(sf.path, af), target_format, sub_output, basename(af, extname(af)), album, artist, cover_path))
        );
        for (const r of results) {
          completed++;
          if (!r.ok) errors.push(r.msg);
          yield { step: "convert", message: `[${sf.name}] ${r.msg}`, progress: completed, total: total_audio };
        }
      }
    }

    // 子文件夹内图片和其他文件
    for (const img of sf.image_files) {
      const dst = join(sub_output, img);
      if (!existsSync(dst)) copyFileSync(join(sf.path, img), dst);
    }
    for (const item of sf.other_items) {
      const src = join(sf.path, item);
      const dst = join(sub_output, item);
      if (!existsSync(dst)) {
        if (statSync(src).isDirectory()) mkdirSync(dst, { recursive: true });
        else copyFileSync(src, dst);
      }
    }
  }

  // 根级别音频
  if (root_audio.length > 0) {
    if (target_format === "none") {
      for (const af of root_audio) {
        const r = copySingle(join(source_path, af), output_dir);
        completed++;
        if (!r.ok) errors.push(r.msg);
        yield { step: "convert", message: r.msg, progress: completed, total: total_audio };
      }
    } else {
      for (let i = 0; i < root_audio.length; i += threads) {
        const batch = root_audio.slice(i, i + threads);
        const results = await Promise.all(
          batch.map((af) => convertSingle(join(source_path, af), target_format, output_dir, basename(af, extname(af)), album, artist, cover_path))
        );
        for (const r of results) {
          completed++;
          if (!r.ok) errors.push(r.msg);
          yield { step: "convert", message: r.msg, progress: completed, total: total_audio };
        }
      }
    }
  }

  // 整理根级别图片和其他文件
  yield { step: "relocate", message: "整理文件位置..." };
  for (const img of root_images) {
    const dst = join(image_dir, img);
    if (!existsSync(dst)) copyFileSync(join(source_path, img), dst);
  }
  for (const item of root_others) {
    const src = join(source_path, item);
    const dst = join(output_dir, item);
    if (!existsSync(dst)) {
      if (statSync(src).isDirectory()) mkdirSync(dst, { recursive: true });
      else copyFileSync(src, dst);
    }
  }

  // 未选中子文件夹原样复制
  for (const sf of unselected_subs) {
    const dst = join(output_dir, sf.name);
    if (!existsSync(dst)) {
      mkdirSync(dst, { recursive: true });
      yield { step: "relocate", message: `复制未选中文件夹: ${sf.name}` };
    }
  }
  yield { step: "relocate", message: "文件整理完成" };

  // 清理临时封面
  const temp_cover = join(source_path, "cover_resized.jpg");
  if (existsSync(temp_cover)) rmSync(temp_cover);

  // 删除源文件
  if (!keep_source) {
    yield { step: "cleanup", message: "删除源文件..." };
    try {
      rmSync(source_path, { recursive: true, force: true });
      yield { step: "cleanup", message: "源文件已删除" };
    } catch (e) {
      yield { step: "cleanup", message: `删除源文件失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    yield { step: "cleanup", message: "保留源文件" };
  }

  yield {
    step: "done",
    message: "处理完成",
    output_path: output_dir,
    total_files: total_audio,
    success_count: total_audio - errors.length,
    error_count: errors.length,
    errors,
  };
}
