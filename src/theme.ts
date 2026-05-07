import chalk from "chalk";
import type { MarkdownTheme } from "@mariozechner/pi-tui";

export const theme = {
  accent: chalk.hex("#7dd3fc"),
  logo: chalk.hex("#2563eb").bold,
  dim: chalk.dim,
  muted: chalk.hex("#64748b"),
  success: chalk.hex("#86efac"),
  error: chalk.hex("#fca5a5"),
  warning: chalk.hex("#fde68a"),
  bashMode: chalk.hex("#c4b5fd"),
  user: chalk.hex("#60a5fa"),
  assistant: chalk.hex("#86efac"),
  thinkingLabel: chalk.hex("#b45309"),
  thinkingText: chalk.hex("#808080").italic,
  system: chalk.hex("#fef3c7"),
  bold: chalk.bold,
};

export const markdownTheme: MarkdownTheme = {
  heading: chalk.bold.cyan,
  link: chalk.blue,
  linkUrl: chalk.dim,
  code: chalk.yellow,
  codeBlock: chalk.green,
  codeBlockBorder: chalk.dim,
  quote: chalk.italic,
  quoteBorder: chalk.dim,
  hr: chalk.dim,
  listBullet: chalk.cyan,
  bold: chalk.bold,
  italic: chalk.italic,
  strikethrough: chalk.strikethrough,
  underline: chalk.underline,
};

export const editorTheme = {
  borderColor: theme.muted,
  selectList: {
    selectedPrefix: theme.accent,
    selectedText: theme.accent,
    description: theme.dim,
    scrollInfo: theme.dim,
    noMatch: theme.dim,
  },
};
