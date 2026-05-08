import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "./theme.ts";

/** 页脚显示状态 */
export interface FooterState {
  cwd: string;
  model: string;
  contextDisplay: string;
  contextPercent: string;
  prompt?: string;
}

/**
 * 将绝对路径中的 home 目录替换为 ~，缩短显示长度。
 */
const compactPath = (cwd: string): string => {
  const home = process.env.HOME;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd;
};

/** 页脚组件，显示当前模型、上下文用量和工作目录 */
export class Footer implements Component {
  constructor(private getState: () => FooterState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    const usage = `${state.contextPercent}%/${state.contextDisplay}`;
    const left = theme.dim(`${state.model} (${usage})`);
    const right = truncateToWidth(theme.dim(compactPath(state.cwd)), width, theme.dim("..."));
    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);

    let stats = left;
    if (leftWidth + rightWidth + 2 <= width) {
      // 左右两端对齐
      stats = `${left}${" ".repeat(width - leftWidth - rightWidth)}${right}`;
    } else if (leftWidth < width) {
      stats = `${left}${" ".repeat(Math.max(1, width - leftWidth))}`;
    } else {
      stats = truncateToWidth(left, width, theme.dim("..."));
    }

    const lines = [stats];
    if (state.prompt) lines.push(theme.systemPrompt(truncateToWidth(state.prompt, width, theme.dim("..."))));
    return lines;
  }
}
