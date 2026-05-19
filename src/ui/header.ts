import { theme } from "./theme.ts";
import type { FooterState } from "./footer.ts";
import type { SubagentSnapshot } from "./subagent-view.ts";

/**
 * 将绝对路径中的 home 目录替换为 ~，缩短显示长度。
 */
const compactPath = (cwd: string): string => {
  const home = process.env.HOME;
  if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
  return cwd;
};

/**
 * 生成 ASCII logo 头部文本。
 */
export const headerText = (state?: Pick<FooterState, "cwd">): string => {
  const logo = [
    "██████╗        ██╗",
    "██╔══██╗       ██║",
    "██████╔╝       ██║",
    "██╔══██╗ ██╗   ██║",
    "██║  ██║ ╚██████╔╝",
    "╚═╝  ╚═╝  ╚═════╝ ",
  ].join("\n");
  const cwd = state ? `\n${theme.dim(compactPath(state.cwd))}` : "";
  return `${theme.logo(logo)} ${theme.dim("v0.1.0")}${cwd}`;
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
