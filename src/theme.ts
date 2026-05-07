import chalk from "chalk";

export const theme = {
  accent: chalk.hex("#7dd3fc"),
  dim: chalk.dim,
  muted: chalk.hex("#64748b"),
  success: chalk.hex("#86efac"),
  error: chalk.hex("#fca5a5"),
  warning: chalk.hex("#fde68a"),
  bashMode: chalk.hex("#c4b5fd"),
  user: chalk.hex("#93c5fd"),
  assistant: chalk.hex("#e5e7eb"),
  system: chalk.hex("#cbd5e1"),
  bold: chalk.bold,
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
