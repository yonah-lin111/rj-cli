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

export type CommandAction =
  | { type: "messages"; messages: string[] }
  | { type: "system-messages"; messages: string[] }
  | { type: "show-model-selector"; search: string }
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
    handler: () => ({ type: "system-messages", messages: [helpText()] }),
  },
  {
    name: "/model",
    usage: "/model [search]",
    description: "Open the model selector.",
    handler: (args) => ({ type: "show-model-selector", search: args.join(" ").trim() }),
  },
  {
    name: "/clear",
    usage: "/clear",
    description: "Start a new empty chat.",
    handler: () => ({ type: "clear", messages: ["Started a new chat."] }),
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
