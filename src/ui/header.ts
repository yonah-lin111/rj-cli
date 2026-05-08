import { theme } from "./theme.ts";

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
