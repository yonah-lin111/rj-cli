import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export interface FooterState {
  cwd: string;
  model: string;
  contextDisplay: string;
  contextPercent: string;
}

function compactPath(cwd: string): string {
  const home = process.env.HOME;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export class Footer implements Component {
  constructor(private getState: () => FooterState) {}

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.getState();
    const pwd = truncateToWidth(theme.dim(compactPath(state.cwd)), width, theme.dim("..."));
    const left = theme.dim(`${state.contextPercent}%/${state.contextDisplay} (auto)`);
    const right = theme.dim(state.model);
    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);

    let stats = left;
    if (leftWidth + rightWidth + 2 <= width) {
      stats = `${left}${" ".repeat(width - leftWidth - rightWidth)}${right}`;
    } else if (leftWidth < width) {
      stats = `${left}${" ".repeat(Math.max(1, width - leftWidth))}`;
    } else {
      stats = truncateToWidth(left, width, theme.dim("..."));
    }

    return [pwd, stats];
  }
}
