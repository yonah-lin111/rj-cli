import { theme } from "./theme.ts";
import type { SubagentSnapshot } from "./subagent-view.ts";

/**
 * 生成 ASCII logo 头部文本。
 */
export const headerText = (): string => {
  const logo = [
    "██████╗        ██╗",
    "██╔══██╗       ██║",
    "██████╔╝       ██║",
    "██╔══██╗ ██╗   ██║",
    "██║  ██║ ╚██████╔╝",
    "╚═╝  ╚═╝  ╚═════╝ ",
  ].join("\n");
  return `${theme.logo(logo)} ${theme.dim("v0.1.0")}`;
};

/**
 * 生成 subagent 打开时的顶部基础状态信息。
 */
export const subagentHeaderText = (snapshot: SubagentSnapshot): string => {
  const statusIcon =
    snapshot.status === "running"
      ? theme.accent("●")
      : snapshot.status === "error"
        ? theme.error("✗")
        : theme.success("✓");
  return `${statusIcon} ${theme.bold(snapshot.agentName)} ${theme.dim("subagent")}`;
};
