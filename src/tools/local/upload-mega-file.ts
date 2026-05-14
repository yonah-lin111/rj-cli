import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

export interface UploadMegaFilePlan {
  sourcePath: string;
  targetPath: string;
  targetFileName: string;
  needsOverwriteConfirm: boolean;
}

export interface UploadMegaFileResult {
  sourcePath: string;
  targetPath: string;
}

const megaFileDirectory = join(homedir(), ".RJ", "source");

const normalizeSourcePath = (sourcePath: string): string => sourcePath.replace(/\\ /g, " ");

const prepareTargetPath = (targetPath: string): void => {
  if (!existsSync(targetPath)) return;
  try {
    chmodSync(targetPath, 0o666);
  } catch {
    // Ignore chmod failures and let the subsequent removal/copy surface the real error.
  }
  rmSync(targetPath, { force: true });
};

export const planUploadMegaFile = (sourcePath: string): UploadMegaFilePlan => {
  const normalizedSourcePath = normalizeSourcePath(sourcePath.trim());
  const sourceStat = statSync(normalizedSourcePath, { throwIfNoEntry: false });
  if (!sourceStat) {
    throw new Error(`Source file does not exist: ${normalizedSourcePath}`);
  }
  if (!sourceStat.isFile()) {
    throw new Error(`Only files are supported: ${normalizedSourcePath}`);
  }

  mkdirSync(megaFileDirectory, { recursive: true });

  const targetPath = join(megaFileDirectory, `meage_source${extname(normalizedSourcePath)}`);

  return {
    sourcePath: normalizedSourcePath,
    targetPath,
    targetFileName: basename(targetPath),
    needsOverwriteConfirm: existsSync(targetPath),
  };
};

export const executeUploadMegaFile = (
  plan: Pick<UploadMegaFilePlan, "sourcePath" | "targetPath">,
): UploadMegaFileResult => {
  const sourceStat = statSync(plan.sourcePath, { throwIfNoEntry: false });
  if (!sourceStat) {
    throw new Error(`Source file does not exist: ${plan.sourcePath}`);
  }
  if (!sourceStat.isFile()) {
    throw new Error(`Only files are supported: ${plan.sourcePath}`);
  }

  mkdirSync(megaFileDirectory, { recursive: true });
  prepareTargetPath(plan.targetPath);
  try {
    copyFileSync(plan.sourcePath, plan.targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      throw new Error(`Permission denied when writing target file: ${plan.targetPath}`);
    }
    throw error;
  }

  const targetStat = statSync(plan.targetPath, { throwIfNoEntry: false });
  if (!targetStat || !targetStat.isFile()) {
    throw new Error(`Failed to create copied file: ${plan.targetPath}`);
  }
  if (targetStat.size !== sourceStat.size) {
    throw new Error(`Copied file size mismatch: ${plan.targetPath}`);
  }

  return { sourcePath: plan.sourcePath, targetPath: plan.targetPath };
};
