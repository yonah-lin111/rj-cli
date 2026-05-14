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
  | { type: "show-rank-selector" }
  | { type: "show-circle-selector" }
  | { type: "show-works-selector" }
  | { type: "show-session-selector" }
  | { type: "clear"; messages?: string[] }
  | { type: "undo" }
  | { type: "quit" }
  | { type: "chat"; text: string }
  | { type: "command-chat"; displayText: string; promptText: string }
  | { type: "fill-input"; text: string; cursorCol?: number };

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
    name: "/rank",
    usage: "/rank",
    description: "Open the RJ ranking selector.",
    handler: () => ({ type: "show-rank-selector" }),
  },
  {
    name: "/circle",
    usage: "/circle",
    description: "Open the circle list selector.",
    handler: () => ({ type: "show-circle-selector" }),
  },
  {
    name: "/works",
    usage: "/works",
    description: "Open the local works selector.",
    handler: () => ({ type: "show-works-selector" }),
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
  {
    name: "/workMatch",
    usage: "/workMatch [path]",
    description: "Preview and process a single-folder work (audio files at root level).",
    handler: (args) => {
      const raw = args.join(" ").trim();
      const path = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).trim() : raw;
      if (!path) {
        return { type: "fill-input", text: "/workMatch []", cursorCol: "/workMatch [".length };
      }
      return {
        type: "command-chat",
        displayText: `/workMatch [${path}]`,
        promptText: `请对作品文件夹 "${path}" 执行单文件夹作品匹配和格式转换流程：
1. 调用 rj_work_ops_preview 预览（target_format 默认 "flac"，multi_folder=false）
2. 根据预览结果，用一次 ask 调用同时询问所有参数：格式转换、线程数、是否保留源文件、封面图片选择、输出路径
3. 根据用户回答调用 rj_work_ops_process 执行处理（multi_folder=false）`,
      };
    },
  },
  {
    name: "/workMatchMulti",
    usage: "/workMatchMulti [path]",
    description: "Preview and process a multi-folder work (subfolders each contain audio files).",
    handler: (args) => {
      const raw = args.join(" ").trim();
      const path = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).trim() : raw;
      if (!path) {
        return { type: "fill-input", text: "/workMatchMulti []", cursorCol: "/workMatchMulti [".length };
      }
      return {
        type: "command-chat",
        displayText: `/workMatchMulti [${path}]`,
        promptText: `请对作品文件夹 "${path}" 执行多文件夹作品匹配和格式转换流程：
1. 调用 rj_work_ops_preview 预览（target_format 默认 "flac"，multi_folder=true）
2. 根据预览结果，用一次 ask 调用同时询问所有参数：格式转换、线程数、是否保留源文件、封面图片选择、输出路径、选择哪些子文件夹
3. 根据用户回答调用 rj_work_ops_process 执行处理（multi_folder=true，传入 selected_folders）`,
      };
    },
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
