import { spawn } from "node:child_process";

/** bash 命令执行结果 */
export interface BashResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut?: boolean;
}

export interface BashRunOptions {
  timeoutMs?: number;
}

export interface BashToolResult {
  content: string;
  resultLabel: string;
  isError: boolean;
}

const defaultToolTimeoutMs = 20_000;
const maxToolOutputLength = 12 * 1024;

const dangerousCommandPatterns: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(^|[;&|]\s*)rm\s+[^;&|]*-[^;&|]*r[^;&|]*f[^;&|]*\s+(["']?\/["']?)(\s|$|[;&|])/i, reason: "refusing to run destructive rm command" },
  { pattern: /(^|[;&|]\s*)(shutdown|reboot|halt|poweroff)\b/i, reason: "refusing to run system power command" },
  { pattern: /(^|[;&|]\s*)mkfs(\.|\b)/i, reason: "refusing to run filesystem formatting command" },
  { pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*}\s*;\s*:/, reason: "refusing to run fork bomb" },
  { pattern: /(^|[;&|]\s*)dd\b[^;&|]*(\bif=\/dev\/|\bof=\/dev\/)/i, reason: "refusing to run dd against /dev" },
];

const interactiveCommandPattern = /(^|[;&|]\s*)(vim|vi|nano|less|more|top|htop)\b/i;

const blockReason = (command: string): string | undefined => {
  for (const { pattern, reason } of dangerousCommandPatterns) {
    if (pattern.test(command)) return reason;
  }
  if (interactiveCommandPattern.test(command)) return "refusing to run interactive command";
  return undefined;
};

const truncateText = (text: string): string => {
  if (text.length <= maxToolOutputLength) return text;
  return `${text.slice(0, maxToolOutputLength)}\n\n[output truncated to ${maxToolOutputLength} characters]`;
};

const formatResult = (result: BashResult, label: string): string => {
  const parts = [`command:\n${result.command}`];
  if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trimEnd()}`);
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
  parts.push(label);
  return truncateText(parts.join("\n\n"));
};

/**
 * 在指定工作目录中执行 bash 命令，返回 stdout、stderr 和退出码。
 */
export const runBash = (command: string, cwd = process.cwd(), options: BashRunOptions = {}): Promise<BashResult> => {
  const shell = process.env.SHELL || "/bin/zsh";

  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

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
      if (timeout) clearTimeout(timeout);
      resolve({ command, stdout, stderr, exitCode, signal, timedOut });
    });
  });
};

export const runBashTool = async (command: string, cwd = process.cwd(), options: BashRunOptions = {}): Promise<BashToolResult> => {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return { content: "blocked: command is required", resultLabel: "blocked", isError: true };
  }

  const reason = blockReason(trimmedCommand);
  if (reason) {
    return { content: `blocked: ${reason}`, resultLabel: "blocked", isError: true };
  }

  const result = await runBash(trimmedCommand, cwd, { timeoutMs: options.timeoutMs ?? defaultToolTimeoutMs });
  const resultLabel = result.timedOut
    ? "timed out"
    : result.exitCode === null
      ? `signal ${result.signal ?? "unknown"}`
      : `exit ${result.exitCode}`;
  const isError = result.timedOut || result.exitCode !== 0;
  return { content: formatResult(result, resultLabel), resultLabel, isError };
};
