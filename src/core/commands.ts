import type { AskQuestion } from "../tools/base/ask.ts";
import { buildLocalConfirmQuestion } from "../ui/local-confirm-dialog.ts";
import {
  planUploadMegaFile,
  type UploadMegaFilePlan,
} from "../tools/local/upload-mega-file.ts";

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
  | { type: "show-settings-selector" }
  | { type: "open-web-ui" }
  | { type: "show-rank-selector" }
  | { type: "show-match-mega-selector" }
  | { type: "show-match-asmrone-selector" }
  | { type: "show-circle-selector" }
  | { type: "show-works-selector" }
  | { type: "show-session-selector" }
  | { type: "clear"; messages?: string[] }
  | { type: "undo" }
  | { type: "quit" }
  | { type: "chat"; text: string }
  | { type: "command-chat"; displayText: string; promptText: string }
  | { type: "upload-mega-file"; sourcePath: string; displayText: string }
  | {
    type: "confirm-upload-mega-file";
    displayText: string;
    questions: AskQuestion[];
    uploadPlan: Pick<UploadMegaFilePlan, "sourcePath" | "targetPath">;
    cancelMessage: string;
  }
  | { type: "fill-input"; text: string; cursorCol?: number };

/** 斜杠命令定义 */
export interface SlashCommand {
  name: string;
  usage: string;
  description: string;
  handler: (args: string[], context: AppCommandContext) => CommandAction;
}

const buildUploadMegaFileConfirmQuestions = (plan: UploadMegaFilePlan): AskQuestion[] => buildLocalConfirmQuestion({
  header: "Overwrite file",
  question: "A file already exists at the destination. Do you want to replace it?",
  confirmLabel: "Replace file",
  confirmDescription: `File name: ${plan.targetFileName}\nTarget path: ${plan.targetPath}`,
  cancelDescription: "Cancel this upload and keep the existing file.",
});

const buildOverwritePrompt = (): string => `请基于本地 RJ 数据库生成一段用户可读的中文概览。

执行要求：
1. 必须先调用一次且仅调用一次 rj_get_overview。
2. 只能基于工具返回结果总结，不得臆造、补充或猜测工具未提供的数据。
3. 输出必须使用简体中文，不要直接粘贴原始 JSON。
4. 输出结构固定为以下 5 个部分，并按此顺序输出：
   - 数据总览
   - 状态分布
   - 来源分布
   - 重点社团
   - 优先处理项
5. 每个部分都应使用自然语言概括，必要时可结合工具返回的计数做简短条目化说明。
6. 如果工具调用失败或返回错误，直接说明失败原因，不要继续生成概览。`;

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
    name: "/setting",
    usage: "/setting",
    description: "Open the settings selector.",
    handler: () => ({ type: "show-settings-selector" }),
  },
  {
    name: "/webUI",
    usage: "/webUI",
    description: "Open the embedded Web UI.",
    handler: () => ({ type: "open-web-ui" }),
  },
  {
    name: "/rank",
    usage: "/rank",
    description: "Open the RJ ranking selector.",
    handler: () => ({ type: "show-rank-selector" }),
  },
  {
    name: "/matchMega",
    usage: "/matchMega",
    description: "Check resource existence in Mega.",
    handler: () => ({ type: "show-match-mega-selector" }),
  },
  {
    name: "/matchASMROne",
    usage: "/matchASMROne",
    description: "Check resource existence in ASMR.ONE.",
    handler: () => ({ type: "show-match-asmrone-selector" }),
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
    name: "/overwrite",
    usage: "/overwrite",
    description: "Generate an AI overview from the local RJ database (not file overwrite).",
    handler: () => ({
      type: "command-chat",
      displayText: "/overwrite",
      promptText: buildOverwritePrompt(),
    }),
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
    name: "/uploadMegaFile",
    usage: "/uploadMegaFile -[path]",
    description: "Copy a local file into ~/.RJ.",
    handler: (args) => {
      const raw = args.join(" ").trim();
      if (!raw) {
        return {
          type: "fill-input",
          text: "/uploadMegaFile -[]",
          cursorCol: "/uploadMegaFile -[".length,
        };
      }
      if (!raw.startsWith("-[") || !raw.endsWith("]")) {
        return {
          type: "messages",
          messages: ["Usage: /uploadMegaFile -[path]"],
        };
      }
      const sourcePath = raw.slice(2, -1);
      if (!sourcePath) {
        return {
          type: "fill-input",
          text: "/uploadMegaFile -[]",
          cursorCol: "/uploadMegaFile -[".length,
        };
      }
      try {
        const uploadPlan = planUploadMegaFile(sourcePath);
        if (!uploadPlan.needsOverwriteConfirm) {
          return {
            type: "upload-mega-file",
            sourcePath,
            displayText: `/uploadMegaFile -[${sourcePath}]`,
          };
        }
        return {
          type: "confirm-upload-mega-file",
          displayText: `/uploadMegaFile -[${sourcePath}]`,
          questions: buildUploadMegaFileConfirmQuestions(uploadPlan),
          uploadPlan: { sourcePath: uploadPlan.sourcePath, targetPath: uploadPlan.targetPath },
          cancelMessage: "Upload cancelled. File was not replaced.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          type: "messages",
          messages: [message],
        };
      }
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
    "Ctrl+E".padEnd(16) + "Open the Explore subagent",
    "Ctrl+Z".padEnd(16) + "Suspend process (background)",
    "Esc".padEnd(16) + "Cancel running AI request or close active picker",
    "Enter".padEnd(16) + "Submit current input or confirm selection",
    "Tab".padEnd(16) + "Switch sections in multi-column selectors",
    "↑ / ↓".padEnd(16) + "Navigate input history or selector items",
  ];
  const notes = [
    "Tips:",
    "!command".padEnd(16) + "Run a bash command, e.g. !pwd",
    "/webUI".padEnd(16) + "Open the embedded Web UI in your browser",
    "/workMatch".padEnd(16) + "Use [] to insert a folder path",
    "/workMatchMulti".padEnd(16) + "Process subfolders under a root folder",
    "/uploadMegaFile".padEnd(16) + "Use -[path] to copy a file into ~/.RJ",
  ];
  return [
    `RJ commands:`,
    ...commandList.map(
      (command) => `${command.usage.padEnd(16)} ${command.description}`,
    ),
    "",
    ...keybindings,
    "",
    ...notes,
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
