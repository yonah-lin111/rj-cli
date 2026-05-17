import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set([".mp3", ".flac"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
const COVER_SIZE = { w: 666, h: 500 };

export interface VoiceMetadataEntry {
  relative_path: string;
  filename: string;
  format: "mp3" | "flac";
  size_mb: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  has_cover: boolean;
}

export interface VoiceMetadataScanArgs {
  source_path: string;
}

export interface VoiceMetadataScanResult {
  success: boolean;
  message: string;
  source_path: string;
  total: number;
  items: VoiceMetadataEntry[];
}

export interface VoiceMetadataUpdateArgs {
  source_path: string;
  relative_path: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  cover_image_path?: string | null;
  cover_image_base64?: string | null;
  remove_cover?: boolean;
}

export interface VoiceMetadataUpdateResult {
  success: boolean;
  message: string;
  item?: VoiceMetadataEntry;
}

export interface VoiceMetadataTemplateArgs {
  source_path: string;
  relative_paths?: string[];
  title_mode?: "keep" | "filename" | "template";
  title_template?: string;
  artist?: string | null;
  album?: string | null;
  cover_image_path?: string | null;
  cover_image_base64?: string | null;
  remove_cover?: boolean;
}

export interface VoiceMetadataTemplateResult {
  success: boolean;
  message: string;
  total: number;
  success_count: number;
  error_count: number;
  updated: VoiceMetadataEntry[];
  errors: Array<{ relative_path: string; message: string }>;
}

interface ProbeTags {
  title: string | null;
  artist: string | null;
  album: string | null;
}

interface ProbeResult extends ProbeTags {
  has_cover: boolean;
}

const trimOptionalText = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const text = value.trim();
  return text ? text : null;
};

const ensureDirectory = (dirPath: string): string => {
  const resolved = resolve(dirPath);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`路径不存在或不是文件夹: ${dirPath}`);
  }
  return resolved;
};

const sanitizeRelativePath = (value: string): string => value.replace(/\\/g, "/").trim();

const resolveSafePath = (sourcePath: string, relativePath: string): string => {
  const normalized = sanitizeRelativePath(relativePath);
  if (!normalized) throw new Error("relative_path 不能为空");
  const fullPath = resolve(sourcePath, normalized);
  const rel = relative(sourcePath, fullPath);
  if (rel.startsWith("..") || rel === "" || resolve(sourcePath) === fullPath) {
    if (resolve(sourcePath) === fullPath) throw new Error("relative_path 必须指向 source_path 内的文件");
    throw new Error(`relative_path 越界: ${relativePath}`);
  }
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    throw new Error(`文件不存在: ${relativePath}`);
  }
  const ext = extname(fullPath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的音频格式: ${relativePath}`);
  }
  return fullPath;
};

const toPosixRelative = (sourcePath: string, filePath: string): string => relative(sourcePath, filePath).replace(/\\/g, "/");

const listAudioFiles = (dirPath: string): string[] => {
  const items: string[] = [];
  const walk = (currentPath: string): void => {
    for (const name of readdirSync(currentPath).sort()) {
      const fullPath = join(currentPath, name);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }
      const ext = extname(name).toLowerCase();
      if (AUDIO_EXTENSIONS.has(ext)) items.push(fullPath);
    }
  };
  walk(dirPath);
  return items.sort((a, b) => toPosixRelative(dirPath, a).localeCompare(toPosixRelative(dirPath, b)));
};

const parseProbeJson = (stdout: string): ProbeResult => {
  const parsed = JSON.parse(stdout) as {
    format?: { tags?: Record<string, unknown> };
    streams?: Array<{ codec_type?: string; disposition?: { attached_pic?: number } }>;
  };
  const tags = parsed.format?.tags ?? {};
  const streamHasCover = (parsed.streams ?? []).some((stream) => {
    if (stream.codec_type !== "video") return false;
    return stream.disposition?.attached_pic === 1;
  });
  return {
    title: trimOptionalText(typeof tags.title === "string" ? tags.title : null),
    artist: trimOptionalText(typeof tags.artist === "string" ? tags.artist : null),
    album: trimOptionalText(typeof tags.album === "string" ? tags.album : null),
    has_cover: streamHasCover,
  };
};

const probeAudio = async (filePath: string): Promise<ProbeResult> => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ], { timeout: 30_000 });
  return parseProbeJson(stdout);
};

const buildEntry = async (sourcePath: string, filePath: string): Promise<VoiceMetadataEntry> => {
  const stat = statSync(filePath);
  const probe = await probeAudio(filePath);
  const format = extname(filePath).toLowerCase() === ".mp3" ? "mp3" : "flac";
  return {
    relative_path: toPosixRelative(sourcePath, filePath),
    filename: basename(filePath),
    format,
    size_mb: Math.round((stat.size / 1024 / 1024) * 100) / 100,
    title: probe.title,
    artist: probe.artist,
    album: probe.album,
    has_cover: probe.has_cover,
  };
};

const createTempOutputPath = (targetPath: string, tempDir: string): string => join(tempDir, basename(targetPath));

const prepareCoverImage = async (args: {
  cover_image_path?: string | null;
  cover_image_base64?: string | null;
}): Promise<string | null> => {
  const directPath = trimOptionalText(args.cover_image_path);
  const base64Text = trimOptionalText(args.cover_image_base64);
  if (!directPath && !base64Text) return null;

  const tempDir = mkdtempSync(join(tmpdir(), "rj-voice-cover-"));
  const inputPath = join(tempDir, "cover-input");
  const outputPath = join(tempDir, "cover.jpg");

  try {
    if (directPath) {
      const resolved = resolve(directPath);
      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        throw new Error(`封面文件不存在: ${directPath}`);
      }
      const ext = extname(resolved).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        throw new Error(`不支持的封面格式: ${directPath}`);
      }
      await writeFile(inputPath + ext, await readFile(resolved));
    } else if (base64Text) {
      const clean = base64Text.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
      if (!clean) throw new Error("cover_image_base64 不能为空");
      await writeFile(`${inputPath}.bin`, Buffer.from(clean, "base64"));
    }

    const inputFiles = readdirSync(tempDir)
      .map((name) => join(tempDir, name))
      .filter((filePath) => filePath !== outputPath)
      .sort();
    const actualInput = inputFiles[0];
    if (!actualInput) throw new Error("封面输入为空");

    const { w, h } = COVER_SIZE;
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", actualInput,
      "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "-q:v", "2",
      outputPath,
    ], { timeout: 120_000 });
    return outputPath;
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
};

const cleanupTempFile = (filePath: string | null | undefined): void => {
  if (!filePath) return;
  rmSync(dirname(filePath), { recursive: true, force: true });
};

const applyMetadataToFile = async (filePath: string, metadata: {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  coverPath?: string | null;
  removeCover?: boolean;
}): Promise<void> => {
  const ext = extname(filePath).toLowerCase();
  const tempDir = mkdtempSync(join(tmpdir(), "rj-voice-meta-"));
  const outputPath = createTempOutputPath(filePath, tempDir);

  const title = trimOptionalText(metadata.title);
  const artist = trimOptionalText(metadata.artist);
  const album = trimOptionalText(metadata.album);
  const removeCover = metadata.removeCover === true;
  const coverPath = metadata.coverPath ?? null;

  try {
    const cmd = ["-y", "-i", filePath];
    if (coverPath && !removeCover) {
      cmd.push(
        "-i", coverPath,
        "-map", "0:a",
        "-map", "1:v",
        "-disposition:v", "attached_pic",
        "-metadata:s:v", "comment=Cover (front)",
      );
    } else {
      cmd.push("-map", "0:a");
    }

    if (ext === ".mp3") {
      cmd.push("-c:a", "copy", "-id3v2_version", "3");
      if (coverPath && !removeCover) cmd.push("-c:v", "mjpeg");
    } else if (ext === ".flac") {
      cmd.push("-c:a", "copy");
      if (coverPath && !removeCover) cmd.push("-c:v", "mjpeg");
    } else {
      throw new Error(`不支持的音频格式: ${filePath}`);
    }

    cmd.push(
      "-metadata", `title=${title ?? ""}`,
      "-metadata", `artist=${artist ?? ""}`,
      "-metadata", `album=${album ?? ""}`,
      outputPath,
    );

    await execFileAsync("ffmpeg", cmd, { timeout: 600_000 });
    renameSync(outputPath, filePath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const resolveTemplateTitle = (mode: VoiceMetadataTemplateArgs["title_mode"], template: string | undefined, relativePath: string): string | null | undefined => {
  if (mode === "keep" || mode == null) return undefined;
  if (mode === "filename") return basename(relativePath, extname(relativePath));
  if (mode === "template") {
    const raw = template?.trim();
    if (!raw) throw new Error("title_template 不能为空");
    const filename = basename(relativePath, extname(relativePath));
    const fullFilename = basename(relativePath);
    return raw
      .replaceAll("{filename}", filename)
      .replaceAll("{basename}", fullFilename)
      .replaceAll("{relative_path}", relativePath);
  }
  return undefined;
};

export const scanVoiceMetadata = async (args: VoiceMetadataScanArgs): Promise<VoiceMetadataScanResult> => {
  const sourcePath = ensureDirectory(args.source_path);
  const files = listAudioFiles(sourcePath);
  const items = await Promise.all(files.map((filePath) => buildEntry(sourcePath, filePath)));
  return {
    success: true,
    message: items.length > 0 ? `扫描到 ${items.length} 个音频文件` : "目录中没有 mp3/flac 文件",
    source_path: sourcePath,
    total: items.length,
    items,
  };
};

export const updateVoiceMetadata = async (args: VoiceMetadataUpdateArgs): Promise<VoiceMetadataUpdateResult> => {
  const sourcePath = ensureDirectory(args.source_path);
  const filePath = resolveSafePath(sourcePath, args.relative_path);
  let coverPath: string | null = null;
  try {
    coverPath = await prepareCoverImage(args);
    await applyMetadataToFile(filePath, {
      title: args.title,
      artist: args.artist,
      album: args.album,
      coverPath,
      removeCover: args.remove_cover,
    });
    const item = await buildEntry(sourcePath, filePath);
    return {
      success: true,
      message: `已更新 ${item.relative_path}`,
      item,
    };
  } finally {
    cleanupTempFile(coverPath);
  }
};

export const applyVoiceMetadataTemplate = async (args: VoiceMetadataTemplateArgs): Promise<VoiceMetadataTemplateResult> => {
  const sourcePath = ensureDirectory(args.source_path);
  const targetPaths = (args.relative_paths?.length ?? 0) > 0
    ? args.relative_paths!.map((item) => resolveSafePath(sourcePath, item))
    : listAudioFiles(sourcePath);

  let coverPath: string | null = null;
  const updated: VoiceMetadataEntry[] = [];
  const errors: Array<{ relative_path: string; message: string }> = [];

  try {
    coverPath = await prepareCoverImage(args);
    for (const filePath of targetPaths) {
      const relativePath = toPosixRelative(sourcePath, filePath);
      try {
        const title = resolveTemplateTitle(args.title_mode, args.title_template, relativePath);
        await applyMetadataToFile(filePath, {
          title,
          artist: args.artist,
          album: args.album,
          coverPath,
          removeCover: args.remove_cover,
        });
        updated.push(await buildEntry(sourcePath, filePath));
      } catch (error) {
        errors.push({
          relative_path: relativePath,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    cleanupTempFile(coverPath);
  }

  return {
    success: errors.length === 0,
    message: errors.length === 0 ? `已更新 ${updated.length} 个音频文件` : `已更新 ${updated.length} 个音频文件，失败 ${errors.length} 个`,
    total: targetPaths.length,
    success_count: updated.length,
    error_count: errors.length,
    updated,
    errors,
  };
};
