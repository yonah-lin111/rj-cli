import { spawn } from "node:child_process";

/** bash 命令执行结果 */
export interface BashResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * 在指定工作目录中执行 bash 命令，返回 stdout、stderr 和退出码。
 */
export const runBash = (command: string, cwd = process.cwd()): Promise<BashResult> => {
  const shell = process.env.SHELL || "/bin/zsh";

  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({ command, stdout, stderr, exitCode, signal });
    });
  });
};
