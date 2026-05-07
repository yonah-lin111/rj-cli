import { CombinedAutocompleteProvider, Container, Editor, ProcessTerminal, Spacer, Text, TUI } from "@mariozechner/pi-tui";
import { runBash } from "./bash.js";
import { formatContextWindow, getModel, getProvider, loadConfig, type RJConfig } from "./config.js";
import { executeSlashCommand, getCommands, helpText, type AppCommandContext } from "./commands.js";
import { Footer } from "./components/footer.js";
import { MessagesView, type Message } from "./components/messages.js";
import { editorTheme, theme } from "./theme.js";

export interface AppState {
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

function createInitialState(config: RJConfig): AppState {
  const provider = getProvider(config, config.defaultProvider);
  const model = getModel(provider, config.defaultModel);

  return {
    cwd: process.cwd(),
    provider: provider.id,
    providerName: provider.name,
    model: model.id,
    contextDisplay: formatContextWindow(model.contextWindow),
    outputLimit: model.outputLimit,
    configPath: config.configPath,
    availableModels: provider.models.map((item) => item.id),
    messageCount: 0,
    commandCount: 0,
    startedAt: new Date(),
  };
}

function headerText(): string {
  const logo = `${theme.bold(theme.accent("RJ"))}${theme.dim(" v0.1.0")}`;
  const compact = [
    `${theme.dim("Ctrl+C")} interrupt/exit`,
    `${theme.dim("/")} commands`,
    `${theme.dim("!")} bash`,
    `${theme.dim("!!")} bash (no context)`,
  ].join(theme.muted(" · "));
  return `${logo}\n${compact}\n${theme.dim("Press /help for commands. Ask a question to get a mock assistant reply.")}`;
}

export class RJApp {
  private config = loadConfig();
  private terminal = new ProcessTerminal();
  private tui = new TUI(this.terminal);
  private root = new Container();
  private chat = new Container();
  private status = new Text("", 1, 0);
  private editor = new Editor(this.tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 8 });
  private messages: Message[] = [];
  private runningBash = false;
  private stopped = false;
  private state: AppState = createInitialState(this.config);

  async start(): Promise<void> {
    this.setupLayout();
    this.setupEditor();
    this.setupSignals();
    this.tui.start();
  }

  stop(exitCode = 0): void {
    if (this.stopped) return;
    this.stopped = true;
    this.tui.stop();
    process.exit(exitCode);
  }

  private setupLayout(): void {
    this.root.addChild(new Spacer(1));
    this.root.addChild(new Text(headerText(), 1, 0));
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.chat);
    this.root.addChild(this.status);
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.editor);
    this.root.addChild(new Footer(() => this.state));

    this.tui.addChild(this.root);
    this.tui.setFocus(this.editor);
    this.refreshChat();
  }

  private setupEditor(): void {
    this.editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        getCommands().map((command) => ({
          name: command.name.slice(1),
          description: command.description,
        })),
        this.state.cwd,
        null,
      ),
    );

    this.editor.onSubmit = (rawText) => {
      void this.handleSubmit(rawText);
    };
  }

  private setupSignals(): void {
    process.on("SIGINT", () => this.stop(0));
    process.on("SIGTERM", () => this.stop(0));
  }

  private async handleSubmit(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) return;
    this.editor.addToHistory(text);

    if (text.startsWith("/")) {
      this.handleSlash(text);
      return;
    }

    if (text.startsWith("!")) {
      await this.handleBash(text);
      return;
    }

    this.addMessage("user", text, "user");
    this.addMessage("assistant", `Mock reply: I received “${text}”. This basic RJ CLI does not call a real LLM yet.`, "assistant");
    this.state.messageCount += 2;
    this.requestRender();
  }

  private handleSlash(text: string): void {
    this.state.commandCount++;
    const context: AppCommandContext = { ...this.state };
    const action = executeSlashCommand(text, context);

    if (action.type === "quit") {
      this.stop(0);
      return;
    }

    if (action.type === "clear") {
      this.messages = [];
      this.state.messageCount = 0;
      this.state.commandCount = 0;
      if (action.messages) {
        for (const message of action.messages) this.addMessage("system", message, "system");
      }
      this.requestRender();
      return;
    }

    if (action.type === "set-model") {
      this.setModel(action.model);
      for (const message of action.messages) this.addMessage("system", message, "model");
      this.requestRender();
      return;
    }

    for (const message of action.messages) this.addMessage("system", message, "command");
    this.requestRender();
  }

  private async handleBash(text: string): Promise<void> {
    if (this.runningBash) {
      this.addMessage("warning", "A bash command is already running. Wait for it to finish.", "warning");
      this.requestRender();
      return;
    }

    const noContext = text.startsWith("!!");
    const command = text.slice(noContext ? 2 : 1).trim();
    if (!command) {
      this.addMessage("warning", "Usage: !<command>", "warning");
      this.requestRender();
      return;
    }

    this.runningBash = true;
    this.state.commandCount++;
    this.status.setText(theme.bashMode(`Running ${noContext ? "bash (no context)" : "bash"}: ${command}`));
    this.addMessage("command", `$ ${command}${noContext ? "  [no context]" : ""}`, "bash");
    this.requestRender();

    try {
      const result = await runBash(command, this.state.cwd);
      const parts = [];
      if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trimEnd()}`);
      if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
      parts.push(`exit ${result.exitCode ?? `signal ${result.signal ?? "unknown"}`}`);
      this.addMessage(result.exitCode === 0 ? "system" : "error", parts.join("\n\n"), "result");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addMessage("error", message, "error");
    } finally {
      this.runningBash = false;
      this.status.setText("");
      this.requestRender();
    }
  }

  private setModel(modelId: string): void {
    const provider = getProvider(this.config, this.state.provider);
    const model = getModel(provider, modelId);
    this.state.model = model.id;
    this.state.contextDisplay = formatContextWindow(model.contextWindow);
    this.state.outputLimit = model.outputLimit;
  }

  private addMessage(kind: Message["kind"], text: string, label?: string): void {
    this.messages.push({ kind, text, label });
  }

  private refreshChat(): void {
    this.chat.clear();
    this.chat.addChild(new MessagesView(() => this.messages));
  }

  private requestRender(): void {
    this.refreshChat();
    this.root.invalidate();
    this.tui.requestRender();
  }
}

export async function startInteractiveApp(): Promise<void> {
  const app = new RJApp();
  await app.start();
}

export function getHelpOutput(): string {
  return [
    "RJ v0.1.0",
    "",
    "Usage:",
    "  rj                 Start interactive TUI",
    "  rj --help          Show help",
    "  rj --version       Show version",
    "",
    helpText(),
  ].join("\n");
}
