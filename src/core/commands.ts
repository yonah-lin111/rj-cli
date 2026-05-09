/** 斜杠命令执行时的上下文信息 */
export interface AppCommandContext {
  cwd: string;
  provider: string;
  providerName: string;
  model: string;
  contextDisplay: string;
  contextPercent: string;
  contextTokens: number;
  outputLimit: number;
  configPath: string;
  availableModels: string[];
  messageCount: number;
  commandCount: number;
  startedAt: Date;
}

/** 斜杠命令执行结果 */
export type CommandAction =
  | { type: "messages"; messages: string[] }
  | { type: "system-messages"; messages: string[] }
  | { type: "show-model-selector"; search: string }
  | { type: "show-session-selector" }
  | { type: "clear"; messages?: string[] }
  | { type: "undo" }
  | { type: "quit" };

/** 斜杠命令定义 */
export interface SlashCommand {
  name: string;
  usage: string;
  description: string;
  handler: (args: string[], context: AppCommandContext) => CommandAction;
}

/** 内置斜杠命令列表 */
const commandList: SlashCommand[] = [
  {
    name: "/help",
    usage: "/help",
    description: "Show available commands.",
    handler: () => ({ type: "system-messages", messages: [helpText()] }),
  },
  {
    name: "/model",
    usage: "/model [search]",
    description: "Open the model selector.",
    handler: (args) => ({
      type: "show-model-selector",
      search: args.join(" ").trim(),
    }),
  },
  {
    name: "/clear",
    usage: "/clear",
    description: "Start a new empty chat.",
    handler: () => ({ type: "clear", messages: ["Started a new chat."] }),
  },
  {
    name: "/undo",
    usage: "/undo",
    description: "Remove the last QA and restore its prompt.",
    handler: () => ({ type: "undo" }),
  },
  {
    name: "/session",
    usage: "/session",
    description: "Browse and restore chat history.",
    handler: () => ({ type: "show-session-selector" }),
  },
  {
    name: "/quit",
    usage: "/quit",
    description: "Exit RJ.",
    handler: () => ({ type: "quit" }),
  },
];

/**
 * 返回所有已注册的斜杠命令。
 */
export const getCommands = (): SlashCommand[] => commandList;

/**
 * 生成帮助文本，包含命令列表和快捷键说明。
 */
export const helpText = (): string => {
  const keybindings = [
    "Keybindings:",
    "Ctrl+C".padEnd(16) + "Clear input, or exit if empty",
    "Ctrl+Z".padEnd(16) + "Suspend process (background)",
    "Esc Esc".padEnd(16) + "Cancel running AI request",
    "↑ / ↓".padEnd(16) + "Navigate input history",
  ];
  return [
    `RJ commands:`,
    ...commandList.map(
      (command) => `${command.usage.padEnd(16)} ${command.description}`,
    ),
    "",
    ...keybindings,
    "",
    "Prefix with ! to run bash, e.g. !pwd",
  ].join("\n");
};

/**
 * 解析并执行斜杠命令，命令不存在时返回错误提示。
 */
export const executeSlashCommand = (
  input: string,
  context: AppCommandContext,
): CommandAction => {
  const [name = "", ...args] = input.trim().split(/\s+/);
  const command = commandList.find((item) => item.name === name);
  if (!command) {
    return {
      type: "messages",
      messages: [
        `Unknown command: ${name}\nType /help to see available commands.`,
      ],
    };
  }
  return command.handler(args, context);
};
