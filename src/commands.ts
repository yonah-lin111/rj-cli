export interface AppCommandContext {
  cwd: string;
  provider: string;
  providerName: string;
  model: string;
  contextDisplay: string;
  outputLimit: number;
  configPath: string;
  availableModels: string[];
  messageCount: number;
  commandCount: number;
  startedAt: Date;
}

export type CommandAction =
  | { type: "messages"; messages: string[] }
  | { type: "set-model"; model: string; messages: string[] }
  | { type: "clear"; messages?: string[] }
  | { type: "quit" };

export interface SlashCommand {
  name: string;
  usage: string;
  description: string;
  handler: (args: string[], context: AppCommandContext) => CommandAction;
}

const commandList: SlashCommand[] = [
  {
    name: "/help",
    usage: "/help",
    description: "Show available commands.",
    handler: () => ({ type: "messages", messages: [helpText()] }),
  },
  {
    name: "/hotkeys",
    usage: "/hotkeys",
    description: "Show basic keyboard shortcuts.",
    handler: () => ({
      type: "messages",
      messages: ["Hotkeys:\nEnter submit\nShift+Enter newline\nCtrl+C exit\n/ commands\n! bash\n!! bash (no-context visual label)"],
    }),
  },
  {
    name: "/session",
    usage: "/session",
    description: "Show current session information.",
    handler: (_args, context) => ({
      type: "messages",
      messages: [
        [
          "Session:",
          `started ${context.startedAt.toLocaleString()}`,
          `cwd ${context.cwd}`,
          `provider ${context.providerName} (${context.provider})`,
          `model ${context.model}`,
          `context ${context.contextDisplay}`,
          `output ${context.outputLimit}`,
          `messages ${context.messageCount}`,
          `commands ${context.commandCount}`,
        ].join("\n"),
      ],
    }),
  },
  {
    name: "/model",
    usage: "/model [name]",
    description: "Show or set the configured model.",
    handler: (args, context) => {
      const model = args.join(" ").trim();
      if (!model) return { type: "messages", messages: [`Current model: ${context.model}\nAvailable models:\n${context.availableModels.join("\n")}`] };
      if (!context.availableModels.includes(model)) {
        return { type: "messages", messages: [`Unknown model: ${model}\nAvailable models:\n${context.availableModels.join("\n")}`] };
      }
      return { type: "set-model", model, messages: [`Model set to ${model}`] };
    },
  },
  {
    name: "/settings",
    usage: "/settings",
    description: "Show basic local settings.",
    handler: (_args, context) => ({
      type: "messages",
      messages: [
        [
          "Settings:",
          `cwd ${context.cwd}`,
          `shell ${process.env.SHELL || "/bin/zsh"}`,
          `config ${context.configPath}`,
          `provider ${context.providerName} (${context.provider})`,
          `model ${context.model}`,
          `context 0.0%/${context.contextDisplay} (auto)`,
          `output ${context.outputLimit}`,
        ].join("\n"),
      ],
    }),
  },
  {
    name: "/new",
    usage: "/new",
    description: "Start a new empty chat.",
    handler: () => ({ type: "clear", messages: ["Started a new chat."] }),
  },
  {
    name: "/clear",
    usage: "/clear",
    description: "Clear the chat view.",
    handler: () => ({ type: "clear", messages: ["Chat cleared."] }),
  },
  {
    name: "/quit",
    usage: "/quit",
    description: "Exit RJ.",
    handler: () => ({ type: "quit" }),
  },
];

export function getCommands(): SlashCommand[] {
  return commandList;
}

export function helpText(): string {
  return [`RJ commands:`, ...commandList.map((command) => `${command.usage.padEnd(16)} ${command.description}`), "", "Prefix with ! to run bash, e.g. !pwd"].join("\n");
}

export function executeSlashCommand(input: string, context: AppCommandContext): CommandAction {
  const [name = "", ...args] = input.trim().split(/\s+/);
  const command = commandList.find((item) => item.name === name);
  if (!command) {
    return { type: "messages", messages: [`Unknown command: ${name}\nType /help to see available commands.`] };
  }
  return command.handler(args, context);
}
