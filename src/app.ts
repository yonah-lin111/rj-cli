import { CombinedAutocompleteProvider, Container, Editor, Input, Loader, ProcessTerminal, SelectList, Spacer, Text, TUI, getKeybindings, matchesKey, type Focusable, type OverlayHandle, type SelectItem } from "@mariozechner/pi-tui";
import { runBash } from "./bash.js";
import { streamChat, type ChatHistoryMessage } from "./ai.js";
import { formatContextWindow, getModel, getProvider, loadConfig, saveDefaultModel, type RJConfig, type RJModelConfig } from "./config.js";
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
  contextPercent: string;
  contextTokens: number;
  contextWindow: number;
  outputLimit: number;
  configPath: string;
  availableModels: string[];
  messageCount: number;
  commandCount: number;
  prompt?: string;
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
    contextPercent: "0.0",
    contextTokens: 0,
    contextWindow: model.contextWindow,
    outputLimit: model.outputLimit,
    configPath: config.configPath,
    availableModels: provider.models.map((item) => item.id),
    messageCount: 0,
    commandCount: 0,
    startedAt: new Date(),
  };
}

function headerText(): string {
  const logo = [
    "██████╗        ██╗",
    "██╔══██╗       ██║",
    "██████╔╝       ██║",
    "██╔══██╗ ██╗   ██║",
    "██║  ██║ ╚██████╔╝",
    "╚═╝  ╚═╝  ╚═════╝ ",
  ].join("\n");
  return `${theme.logo(logo)} ${theme.dim("v0.1.0")}`;
}

class ModelSelector extends Container implements Focusable {
  private search = new Input();
  private list: SelectList;
  private details = new Text();

  focused = false;

  constructor(models: RJModelConfig[], currentModelId: string, onSelect: (modelId: string) => void, onCancel: () => void, initialSearch = "") {
    super();

    const items = models.map((model) => ({
      value: model.id,
      label: model.name,
      description: `${formatContextWindow(model.contextWindow)} context · ${model.outputLimit} output${model.id === currentModelId ? " · current" : ""}`,
    }));
    this.list = new SelectList(items, 10, editorTheme.selectList, { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 36 });

    this.search.setValue(initialSearch);
    this.search.onSubmit = () => this.selectCurrent();
    this.list.onSelect = (item) => onSelect(item.value);
    this.list.onCancel = onCancel;
    this.list.onSelectionChange = (item) => this.updateDetails(item);
    this.list.setSelectedIndex(Math.max(0, items.findIndex((item) => item.value === currentModelId)));
    this.list.setFilter(initialSearch);

    this.addChild(new Text(theme.bold("Select model"), 1, 0));
    this.addChild(new Text(theme.dim("Type to filter, ↑/↓ move, Enter select, Esc cancel"), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.search);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.details);
    this.updateDetails(this.list.getSelectedItem());
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down") || kb.matches(keyData, "tui.select.confirm") || kb.matches(keyData, "tui.select.cancel")) {
      this.list.handleInput(keyData);
      return;
    }
    this.search.handleInput(keyData);
    this.list.setFilter(this.search.getValue());
    this.updateDetails(this.list.getSelectedItem());
  }

  invalidate(): void {
    super.invalidate();
    this.search.invalidate();
    this.list.invalidate();
  }

  private selectCurrent(): void {
    const item = this.list.getSelectedItem();
    if (item) this.list.onSelect?.(item);
  }

  private updateDetails(item: SelectItem | null): void {
    this.details.setText(item ? theme.dim(`Model ID: ${item.value}`) : theme.dim("No matching models"));
  }
}

export class RJApp {
  private config = loadConfig();
  private terminal = new ProcessTerminal();
  private tui = new TUI(this.terminal);
  private root = new Container();
  private chat = new Container();
  private status = new Container();
  private loadingAnimation?: Loader;
  private modelSelector?: OverlayHandle;
  private editor = new Editor(this.tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 8 });
  private messages: Message[] = [];
  private runningAI = false;
  private runningBash = false;
  private activeAIAbort?: AbortController;
  private activeQA?: { user: Message; assistant?: Message };
  private lastEscapeAt = 0;
  private promptTimer?: NodeJS.Timeout;
  private stopped = false;
  private state: AppState = createInitialState(this.config);

  async start(): Promise<void> {
    this.setupLayout();
    this.setupEditor();
    this.setupInputHandlers();
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

  private setupInputHandlers(): void {
    this.tui.addInputListener((data) => {
      if (!matchesKey(data, "escape")) return;
      const now = Date.now();
      const isDoubleEscape = now - this.lastEscapeAt <= 500;
      this.lastEscapeAt = now;
      if (!isDoubleEscape || !this.runningAI) return;
      this.cancelAIResponse();
      return { consume: true };
    });
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

    await this.handleChat(text);
  }

  private async handleChat(text: string): Promise<void> {
    if (this.runningAI) {
      this.addMessage("warning", "An AI request is already running. Wait for it to finish.", "warning");
      this.requestRender();
      return;
    }

    this.runningAI = true;
    const user = this.addMessage("user", text, "user");
    this.activeQA = { user };
    this.state.messageCount++;
    this.updateContextUsage();

    const provider = getProvider(this.config, this.state.provider);
    const model = getModel(provider, this.state.model);
    this.startLoading(`Working with ${model.id}...`);
    this.requestRender();

    let assistant: Message | undefined;
    let assistantIndex = -1;
    const abortController = new AbortController();
    this.activeAIAbort = abortController;
    try {
      assistantIndex = this.messages.length;
      assistant = this.addMessage("assistant", "", "assistant");
      if (this.activeQA) this.activeQA.assistant = assistant;
      await streamChat({
        provider,
        model: model.id,
        messages: this.chatHistory(),
        maxTokens: model.outputLimit,
        signal: abortController.signal,
        onDelta: (delta) => {
          if (!assistant) return;
          if (delta.thinking) assistant.thinking = `${assistant.thinking ?? ""}${delta.thinking}`;
          if (delta.content) assistant.text += delta.content;
          this.updateContextUsage();
          this.requestRender();
        },
      });
      this.state.messageCount++;
      this.updateContextUsage();
    } catch (error) {
      if (abortController.signal.aborted) return;
      if (assistant && !assistant.text.trim() && !assistant.thinking?.trim()) this.messages.splice(assistantIndex, 1);
      const message = error instanceof Error ? error.message : String(error);
      this.addMessage("error", message, "error");
    } finally {
      if (this.activeAIAbort === abortController) this.activeAIAbort = undefined;
      this.activeQA = undefined;
      this.runningAI = false;
      this.stopLoading();
      this.requestRender();
    }
  }

  private chatHistory(): ChatHistoryMessage[] {
    return this.messages
      .filter((message) => (message.kind === "user" || message.kind === "assistant") && message.text.trim())
      .map((message) => ({ role: message.kind as "user" | "assistant", content: message.text.trim() }));
  }

  private updateContextUsage(): void {
    const tokens = this.estimateContextTokens();
    const percent = this.state.contextWindow > 0 ? (tokens / this.state.contextWindow) * 100 : 0;
    this.state.contextTokens = tokens;
    this.state.contextPercent = percent.toFixed(1);
  }

  private estimateContextTokens(): number {
    return this.chatHistory().reduce((total, message) => total + Math.ceil(message.content.length / 4) + 4, 0);
  }

  private contextUsageDisplay(): string {
    return `${this.state.contextPercent}%/${this.state.contextDisplay}`;
  }

  private cancelAIResponse(): void {
    if (!this.runningAI) return;
    if (this.activeQA) {
      this.activeQA.user.strikethrough = true;
      if (this.activeQA.assistant) this.activeQA.assistant.strikethrough = true;
    }
    this.activeAIAbort?.abort();
    this.showPrompt("Response cancelled");
    this.requestRender();
  }

  private showPrompt(message: string): void {
    if (this.promptTimer) clearTimeout(this.promptTimer);
    this.state.prompt = message;
    this.promptTimer = setTimeout(() => {
      this.state.prompt = undefined;
      this.promptTimer = undefined;
      this.requestRender();
    }, 3000);
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
      this.updateContextUsage();
      if (action.messages?.[0]) this.showPrompt(action.messages[0]);
      this.requestRender();
      return;
    }

    if (action.type === "show-model-selector") {
      this.showModelSelector(action.search);
      this.requestRender();
      return;
    }

    for (const message of action.messages) this.showPrompt(message);
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
    this.startLoading(`Running ${noContext ? "bash (no context)" : "bash"}: ${command}`, theme.bashMode);
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
      this.stopLoading();
      this.requestRender();
    }
  }

  private startLoading(message: string, spinnerColor: (text: string) => string = theme.accent): void {
    this.stopLoading();
    this.loadingAnimation = new Loader(this.tui, spinnerColor, theme.muted, message, {
      frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
      intervalMs: 80,
    });
    this.status.addChild(this.loadingAnimation);
  }

  private stopLoading(): void {
    this.loadingAnimation?.stop();
    this.loadingAnimation = undefined;
    this.status.clear();
  }

  private showModelSelector(initialSearch = ""): void {
    this.modelSelector?.hide();
    const provider = getProvider(this.config, this.state.provider);
    const selector = new ModelSelector(
      provider.models,
      this.state.model,
      (modelId) => {
        this.modelSelector?.hide();
        this.modelSelector = undefined;
        this.setModel(modelId);
        this.showPrompt(`Model set to ${getModel(provider, modelId).name}`);
        this.requestRender();
      },
      () => {
        this.modelSelector?.hide();
        this.modelSelector = undefined;
        this.requestRender();
      },
      initialSearch,
    );
    this.modelSelector = this.tui.showOverlay(selector, { width: "100%", maxHeight: "80%", anchor: "center", margin: 0 });
  }

  private setModel(modelId: string): void {
    const provider = getProvider(this.config, this.state.provider);
    const model = getModel(provider, modelId);
    this.config = saveDefaultModel(this.config, provider.id, model.id);
    this.state.provider = provider.id;
    this.state.providerName = provider.name;
    this.state.model = model.id;
    this.state.contextDisplay = formatContextWindow(model.contextWindow);
    this.state.contextWindow = model.contextWindow;
    this.state.outputLimit = model.outputLimit;
    this.updateContextUsage();
  }

  private addMessage(kind: Message["kind"], text: string, label?: string): Message {
    const message: Message = { kind, text, label };
    this.messages.push(message);
    return message;
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
