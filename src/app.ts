import {
  Container, Editor, Loader, ProcessTerminal, Spacer, Text, TUI,
  matchesKey, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS,
} from "@mariozechner/pi-tui";
import { runBash, runBashTool } from "./tools/base/bash.ts";
import { writeFileTool, editFileTool, readFileTool, type FileEdit } from "./tools/base/file-writer.ts";
import { todoWriteTool } from "./tools/base/todo.ts";
import { streamChat, type ChatHistoryMessage, type ToolCall, type ToolResult, writeFileTool as writeFileSchema, editFileTool as editFileSchema, readFileToolSchema, bashToolSchema, todoWriteToolSchema, rjGetRankingSchema, rjQuerySchema, rjGetDetailSchema, rjGetOverviewSchema, askToolSchema, exploreToolSchema } from "./core/ai.ts";
import { getRankingTool, queryRjTool, getRjDetailTool, getOverviewTool } from "./tools/rj-server/index.ts";
import {
  formatContextWindow, getModel, getProvider, loadConfig, loadPromptHistory,
  saveDefaultModel, savePromptHistory,
} from "./core/config.ts";
import { AppState, createInitialState } from "./core/state.ts";
import { executeSlashCommand, getCommands, helpText, type AppCommandContext } from "./core/commands.ts";
import { Footer } from "./ui/footer.ts";
import { headerText, subagentHeaderText } from "./ui/header.ts";
import { ModelSelector } from "./ui/model-selector.ts";
import { SessionSelector } from "./ui/session-selector.ts";
import { AskPrompt } from "./ui/ask-prompt.ts";
import { createAskId, registerAskPending, resolveAsk, rejectAsk, formatAskResult, type AskQuestion } from "./tools/base/ask.ts";
import { MessagesView, type Message, type AssistantSegment, type ToolCallEntry } from "./ui/messages.ts";
import { editorTheme, theme } from "./ui/theme.ts";
import { expandAtMentions } from "./tools/base/file-reader.ts";
import { RJAutocompleteProvider } from "./utils/autocomplete.ts";
import { buildSystemPrompt } from "./prompts/system.ts";
import { generateSessionId, saveSession, loadSession, listSessions, generateSessionTitle, type SessionRecord } from "./core/session.ts";
import { createSubagentSnapshot, type SubagentSnapshot } from "./ui/subagent-view.ts";
import { runSubagent } from "./subagent/runner.ts";
import type { RJSubagentConfig } from "./core/config.ts";


/** 主应用类，管理 TUI 布局、消息历史和 AI 交互 */
export class RJApp {
  private config = loadConfig();
  private promptHistory: string[] = loadPromptHistory();
  private terminal = new ProcessTerminal();
  private tui = new TUI(this.terminal);
  private root = new Container();
  private header = new Text(headerText(), 1, 0);
  private chat = new Container();
  private status = new Container();
  private input = new Container();
  private loadingAnimation?: Loader;
  private todoLoadingTimer?: NodeJS.Timeout;
  private modelSelector?: ModelSelector;
  private sessionSelector?: SessionSelector;
  private askPrompt?: AskPrompt;
  /** 所有 subagent 执行快照，按 subagentId 索引，用于 ctrl+o 重新打开 */
  private subagentSnapshots = new Map<string, SubagentSnapshot>();
  /** 当前 ctrl+o 打开的 subagentId */
  private openSubagentId?: string;
  private currentSessionId: string = generateSessionId();
  private currentSessionTitle?: string;
  private editor = new Editor(this.tui, editorTheme, { paddingX: 1, autocompleteMaxVisible: 8 });
  private messages: Message[] = [];
  private sessionMessages: ChatHistoryMessage[] = [];
  private runningAI = false;
  private runningBash = false;
  private activeAIAbort?: AbortController;
  private activeQA?: { user: Message; assistant?: Message; sessionStartIndex: number; promptText: string };
  private cancelledQA?: { sessionStartIndex: number };
  private pendingUndoPrompt?: string;
  private lastEscapeAt = 0;
  private suppressEscapeCancelUntil = 0;
  private promptTimer?: NodeJS.Timeout;
  private stopped = false;
  private state: AppState = createInitialState(this.config);

  async start(): Promise<void> {
    const kb = new KeybindingsManager(TUI_KEYBINDINGS, { "tui.editor.undo": ["ctrl+-", "ctrl+z"] });
    setKeybindings(kb);
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
    this.root.addChild(this.header);
    this.root.addChild(new Spacer(1));
    this.root.addChild(this.chat);
    this.root.addChild(this.status);
    this.root.addChild(this.input);
    this.root.addChild(new Footer(
      () => this.state,
      () => {
        const snapshot = this.openSubagentId ? this.subagentSnapshots.get(this.openSubagentId) : undefined;
        return snapshot ? { snapshot } : undefined;
      },
    ));

    this.tui.addChild(this.root);
    this.tui.setFocus(this.editor);
    this.refreshChat();
  }

  private setupEditor(): void {
    this.editor.setAutocompleteProvider(
      new RJAutocompleteProvider(
        getCommands().map((command) => ({
          name: command.name.slice(1),
          description: command.description,
        })),
        this.state.cwd,
      ),
    );

    for (const entry of this.promptHistory) {
      this.editor.addToHistory(entry);
    }

    this.editor.onSubmit = (rawText) => {
      void this.handleSubmit(rawText);
    };
  }

  private setupInputHandlers(): void {
    this.tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c")) {
        if (this.editor.getText().length > 0) {
          this.editor.setText("");
          this.requestRender();
        } else {
          this.stop(0);
        }
        return { consume: true };
      }

      // ctrl+o 打开最近一个 subagent 详情
      if (matchesKey(data, "ctrl+o")) {
        this.openSubagentView();
        return { consume: true };
      }

      if (this.sessionSelector) {
        this.sessionSelector.handleInput(data);
        this.requestRender();
        return { consume: true };
      }

      if (!matchesKey(data, "escape")) return;
      if (this.askPrompt) {
        this.askPrompt.handleInput(data);
        return { consume: true };
      }
      if (this.openSubagentId) {
        this.closeSubagentViewFromEscape();
        return { consume: true };
      }
      if (Date.now() < this.suppressEscapeCancelUntil) {
        return { consume: true };
      }
      if (!this.runningAI) return;
      this.cancelAIResponse();
      return { consume: true };
    });
  }

  private setupSignals(): void {
    process.on("SIGINT", () => {
      if (this.editor.getText().length > 0) {
        this.editor.setText("");
        this.requestRender();
      } else {
        this.stop(0);
      }
    });
    process.on("SIGTERM", () => this.stop(0));
  }

  private async handleSubmit(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) return;
    this.editor.addToHistory(text);

    if (text.startsWith("/") && /^\/[^\s/]+(\s|$)/.test(text)) {
      this.handleSlash(text);
      return;
    }

    if (text.startsWith("!")) {
      if (this.promptHistory.at(-1) !== text) {
        this.promptHistory.push(text);
        savePromptHistory(this.promptHistory);
      }
      await this.handleBash(text);
      return;
    }

    if (this.promptHistory.at(-1) !== text) {
      this.promptHistory.push(text);
      savePromptHistory(this.promptHistory);
    }
    await this.handleChat(text);
  }

  private async handleChat(text: string): Promise<void> {
    if (this.runningAI) {
      this.addMessage("warning", "An AI request is already running. Wait for it to finish.", "warning");
      this.requestRender();
      return;
    }

    const { expanded, warnings } = expandAtMentions(text, this.state.cwd, this.config.fileReading);
    for (const warning of warnings) {
      this.addMessage("warning", warning, "warning");
    }

    const isFirstMessage = this.sessionMessages.length === 0;
    this.runningAI = true;
    const user = this.addMessage("user", text, "user");
    if (expanded !== text) user.expandedText = expanded;
    this.state.messageCount++;
    this.updateContextUsage();

    const provider = getProvider(this.config, this.state.provider);
    const model = getModel(provider, this.state.model);

    const sessionStartIndex = this.sessionMessages.length;
    const userHistoryMessage: ChatHistoryMessage = { role: "user", content: expanded };
    this.sessionMessages.push(userHistoryMessage);

    this.updateContextUsage();
    this.startLoading(`Working with ${model.id}...`);
    this.requestRender();

    let assistant: Message | undefined;
    let assistantIndex = -1;
    let currentSegment: AssistantSegment | undefined;
    const abortController = new AbortController();
    this.activeAIAbort = abortController;
    try {
      assistantIndex = this.messages.length;
      assistant = this.addMessage("assistant", "", "assistant");
      assistant.segments = [];
      this.activeQA = { user, assistant, sessionStartIndex, promptText: text };
      await streamChat({
        provider,
        model: model.id,
        messages: this.chatHistory(),
        maxTokens: model.outputLimit,
        tools: [writeFileSchema, editFileSchema, readFileToolSchema, bashToolSchema, todoWriteToolSchema, rjGetRankingSchema, rjQuerySchema, rjGetDetailSchema, rjGetOverviewSchema, askToolSchema, exploreToolSchema],
        signal: abortController.signal,
        onTurn: () => {
          currentSegment = { text: "" };
          assistant!.segments!.push(currentSegment);
          this.requestRender();
        },
        onDelta: (delta) => {
          if (!currentSegment) return;
          if (delta.thinking) currentSegment.thinking = `${currentSegment.thinking ?? ""}${delta.thinking}`;
          if (delta.content) currentSegment.text += delta.content;
          this.updateContextUsage();
          this.requestRender();
        },
        onToolCalls: async (calls: ToolCall[]): Promise<ToolResult[]> => {
          const results: ToolResult[] = [];
          for (const call of calls) {
            let args: Record<string, unknown>;
            let path = "";
            let command = "";
            let callLabel = call.name;
            let entry: ToolCallEntry | undefined;

            const setToolEntry = (status: ToolCallEntry["status"], resultText: string, isError = false): void => {
              if (!entry) return;
              entry.status = status;
              entry.resultLabel = resultText;
              entry.resultText = resultText;
              entry.isError = isError;
            };

            try {
              args = JSON.parse(call.arguments) as Record<string, unknown>;
              path = typeof args.path === "string" ? args.path : "";
              command = typeof args.command === "string" ? args.command : "";
            } catch (err) {
              const resultText = err instanceof Error ? err.message : String(err);
              entry = { id: call.id, name: call.name, status: "error", callLabel, resultLabel: resultText, resultText, isError: true };
              if (currentSegment) currentSegment.toolCalls = [...(currentSegment.toolCalls ?? []), entry];
              results.push({ tool_call_id: call.id, toolName: call.name, content: resultText, isError: true });
              this.requestRender();
              continue;
            }

            if (call.name === "read_file") callLabel = `Read ${path}`;
            else if (call.name === "write_file") callLabel = `Write ${path}`;
            else if (call.name === "edit_file") callLabel = `Edit ${path}`;
            else if (call.name === "bash") callLabel = `Bash ${command}`;
            else if (call.name === "todowrite") callLabel = "Update todos";
            else if (call.name === "rj_get_ranking") callLabel = `Ranking ${args.ranking_type ?? ""}`;
            else if (call.name === "rj_query") callLabel = "Query RJ";
            else if (call.name === "rj_get_detail") callLabel = `Detail ${args.rj_code ?? ""}`;
            else if (call.name === "rj_get_overview") callLabel = "RJ Overview";

            entry = { id: call.id, name: call.name, status: "running", callLabel, spinnerFrame: 0 };
            if (currentSegment) {
              currentSegment.toolCalls = [...(currentSegment.toolCalls ?? []), entry];
              this.requestRender();
            }

            const spinnerTimer = setInterval(() => {
              if (!entry) return;
              entry.spinnerFrame = ((entry.spinnerFrame ?? 0) + 1) % 10;
              this.requestRender();
            }, 80);

            let resultText: string;
            let isError = false;
            try {
              if (call.name === "read_file") {
                const result = await readFileTool(path, this.state.cwd);
                resultText = result.content;
                entry.resultLabel = path;
                entry.resultText = resultText;
              } else if (call.name === "write_file") {
                const result = await writeFileTool(path, args.content as string, this.state.cwd);
                resultText = result.created ? `Created ${path}` : `Overwrote ${path}`;
                entry.resultLabel = resultText;
                entry.resultText = resultText;
                if (result.diff) entry.displayText = result.diff;
              } else if (call.name === "edit_file") {
                const result = await editFileTool(path, args.edits as FileEdit[], this.state.cwd);
                resultText = `Patched ${path}`;
                entry.resultLabel = resultText;
                entry.resultText = resultText;
                if (result.diff) entry.displayText = result.diff;
              } else if (call.name === "bash") {
                const result = await runBashTool(command, this.state.cwd);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "todowrite") {
                const result = todoWriteTool(args.todos);
                resultText = result.content;
                entry.displayText = result.displayText;
                entry.resultText = resultText;
                this.syncTodoLoadingAnimation(assistant);
              } else if (call.name === "rj_get_ranking") {
                const result = await getRankingTool(args as unknown as Parameters<typeof getRankingTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rj_query") {
                const result = queryRjTool(args as Parameters<typeof queryRjTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rj_get_detail") {
                const result = getRjDetailTool(args as unknown as Parameters<typeof getRjDetailTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rj_get_overview") {
                const result = getOverviewTool();
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "explore") {
                const task = typeof args.task === "string" ? args.task : "Explore files";
                const exploreAgent = this.config.subagents.find((a) => a.id === "explore");
                if (!exploreAgent) {
                  resultText = "Explore agent not configured.";
                  isError = true;
                  setToolEntry("error", resultText, true);
                } else {
                  entry.callLabel = task.slice(0, 60);
                  clearInterval(spinnerTimer);
                  // 启动 explore 专用 spinner
                  const exploreSpinner = setInterval(() => {
                    entry.spinnerFrame = ((entry.spinnerFrame ?? 0) + 1) % 10;
                    this.requestRender();
                  }, 80);
                  this.requestRender();
                  const subagentResult = await this.runExploreSubagent(exploreAgent, task, entry);
                  clearInterval(exploreSpinner);
                  resultText = subagentResult;
                }
              } else if (call.name === "ask") {
                const questions = args.questions as AskQuestion[];
                entry.resultLabel = `Asking ${questions.length} question${questions.length > 1 ? "s" : ""}...`;
                clearInterval(spinnerTimer);
                this.requestRender();
                try {
                  const answers = await new Promise<string[][]>((resolve, reject) => {
                    const id = createAskId();
                    registerAskPending(id, resolve, reject);
                    this.showAskPrompt(id, questions);
                  });
                  const result = formatAskResult(questions, answers);
                  resultText = result.content;
                  entry.resultLabel = result.resultLabel;
                  entry.resultText = resultText;
                  entry.displayText = answers
                    .map((ans, i) => `${questions[i]?.header ?? ""}: ${ans.join(", ")}`)
                    .join("\n");
                } catch {
                  resultText = "The user dismissed this question.";
                  isError = true;
                  setToolEntry("error", resultText, true);
                }
              } else {
                resultText = `Unknown tool: ${call.name}`;
                isError = true;
                setToolEntry("error", resultText, true);
              }
              entry.status = isError ? "error" : "completed";
            } catch (err) {
              resultText = err instanceof Error ? err.message : String(err);
              isError = true;
              setToolEntry("error", resultText, true);
            } finally {
              clearInterval(spinnerTimer);
            }
            results.push({ tool_call_id: call.id, toolName: call.name, content: resultText, isError });
            this.requestRender();
          }
          return results;
        },
        onHistoryMessage: (message) => {
          this.sessionMessages.push(message);
          this.updateContextUsage();
        },
      });
      this.state.messageCount++;
      this.updateContextUsage();
    } catch (error) {
      if (abortController.signal.aborted) {
        if (this.cancelledQA) this.sessionMessages.splice(this.cancelledQA.sessionStartIndex);
        return;
      }
      const hasContent = assistant?.segments?.some(s => s.text.trim() || s.thinking?.trim());
      if (assistant && !hasContent && assistantIndex >= 0) {
        this.messages.splice(assistantIndex, 1);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.addMessage("error", message, "error");
    } finally {
      if (this.activeAIAbort === abortController) this.activeAIAbort = undefined;
      this.activeQA = undefined;
      this.cancelledQA = undefined;
      this.runningAI = false;
      if (this.pendingUndoPrompt !== undefined) {
        this.editor.setText(this.pendingUndoPrompt);
        this.pendingUndoPrompt = undefined;
      }
      this.stopTodoLoadingAnimation();
      this.stopLoading();
      this.persistSession();
      this.requestRender();
    }

    if (isFirstMessage && !this.currentSessionTitle && !abortController.signal.aborted) {
      void generateSessionTitle(provider, model.id, text).then((title) => {
        if (title && !this.currentSessionTitle) {
          this.currentSessionTitle = title;
          this.persistSession();
        }
      });
    }
  }

  /**
   * 构建发送给 AI 的对话历史，开头注入系统提示词。
   */
  private chatHistory(): ChatHistoryMessage[] {
    return [buildSystemPrompt(this.state.cwd), ...this.sessionMessages];
  }

  private estimateMessageTokens(message: ChatHistoryMessage): number {
    let text = message.role === "assistant" && message.blocks?.length ? "" : (message.content ?? "");
    if (message.role === "assistant") {
      for (const block of message.blocks ?? []) {
        if (block.type === "thinking") text += block.thinking;
        else if (block.type === "toolCall") text += block.toolCall.name + block.toolCall.arguments;
      }
      if (!message.blocks?.length) {
        for (const call of message.tool_calls ?? []) text += call.name + call.arguments;
      }
    }
    if (message.role === "tool") text += message.tool_call_id + (message.toolName ?? "");
    return Math.ceil(text.length / 4) + 4;
  }

  private updateContextUsage(): void {
    const tokens = this.estimateContextTokens();
    const percent = this.state.contextWindow > 0 ? (tokens / this.state.contextWindow) * 100 : 0;
    this.state.contextTokens = tokens;
    this.state.contextPercent = percent.toFixed(1);
  }

  /**
   * 按字符数粗略估算 token 用量（4 字符 ≈ 1 token）。
   */
  private estimateContextTokens(): number {
    return this.chatHistory().reduce((total, message) => total + this.estimateMessageTokens(message), 0);
  }

  private resetContextUsage(): void {
    this.state.contextTokens = 0;
    this.state.contextPercent = "0.0";
  }

  private cancelAIResponse(): void {
    if (!this.runningAI) return;
    if (this.activeQA) {
      this.activeQA.user.compact = true;
      this.activeQA.user.strikethrough = true;
      this.cancelledQA = { sessionStartIndex: this.activeQA.sessionStartIndex };
      if (this.activeQA.assistant) {
        this.activeQA.assistant.compact = true;
        this.activeQA.assistant.strikethrough = true;
      }
    }
    this.activeAIAbort?.abort();
    this.showPrompt("Response cancelled");
    this.requestRender();
  }

  private undoLastQA(): void {
    let assistantIndex = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i]?.kind === "assistant") {
        assistantIndex = i;
        break;
      }
    }
    if (assistantIndex <= 0) {
      this.showPrompt("No QA to undo.");
      return;
    }

    let userIndex = -1;
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (this.messages[i]?.kind === "user") {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) {
      this.showPrompt("No QA to undo.");
      return;
    }

    const userPrompt = this.messages[userIndex]?.text ?? "";
    this.messages.splice(userIndex, assistantIndex - userIndex + 1);
    this.removeLastSessionQA();
    this.state.messageCount = Math.max(0, this.state.messageCount - 2);
    this.updateContextUsage();
    this.editor.setText(userPrompt);
    this.showPrompt("Removed last QA.");
  }

  private removeLastSessionQA(): void {
    let assistantIndex = -1;
    for (let i = this.sessionMessages.length - 1; i >= 0; i--) {
      if (this.sessionMessages[i]?.role === "assistant") {
        assistantIndex = i;
        break;
      }
    }
    if (assistantIndex < 0) return;

    let userIndex = -1;
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (this.sessionMessages[i]?.role === "user") {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;
    this.sessionMessages.splice(userIndex);
  }

  private showPrompt(message: string): void {
    if (this.promptTimer) clearTimeout(this.promptTimer);
    this.state.prompt = message;
    // 3 秒后自动清除提示
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
      this.persistSession();
      this.messages = [];
      this.sessionMessages = [];
      this.currentSessionId = generateSessionId();
      this.currentSessionTitle = undefined;
      this.state.messageCount = 0;
      this.state.commandCount = 0;
      this.resetContextUsage();
      if (action.messages?.[0]) this.showPrompt(action.messages[0]);
      this.requestRender();
      return;
    }

    if (action.type === "undo") {
      if (this.runningAI && this.activeQA) {
        const activeQA = this.activeQA;
        this.pendingUndoPrompt = activeQA.promptText;
        const userIndex = this.messages.indexOf(activeQA.user);
        if (userIndex >= 0) this.messages.splice(userIndex, activeQA.assistant ? 2 : 1);
        this.sessionMessages.splice(activeQA.sessionStartIndex);
        this.state.messageCount = Math.max(0, this.state.messageCount - 1);
        this.activeAIAbort?.abort();
        this.showPrompt("Removed last QA.");
        this.updateContextUsage();
      } else {
        this.undoLastQA();
      }
      this.requestRender();
      return;
    }

    if (action.type === "show-session-selector") {
      this.showSessionSelector();
      this.requestRender();
      return;
    }

    if (action.type === "show-model-selector") {
      this.showModelSelector(action.search);
      this.requestRender();
      return;
    }

    if (action.type === "system-messages") {
      for (const message of action.messages) this.addMessage("system", message);
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

    // !! 前缀表示不将结果注入上下文
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

  private syncTodoLoadingAnimation(message?: Message): void {
    const hasInProgressTodo = message?.segments?.some((segment) =>
      segment.toolCalls?.some((entry) => entry.name === "todowrite" && entry.displayText?.includes("[loading]")),
    ) ?? false;

    if (!hasInProgressTodo) {
      this.stopTodoLoadingAnimation();
      return;
    }
    if (this.todoLoadingTimer) return;

    this.todoLoadingTimer = setInterval(() => {
      for (const segment of message?.segments ?? []) {
        for (const entry of segment.toolCalls ?? []) {
          if (entry.name === "todowrite" && entry.displayText?.includes("[loading]")) {
            entry.spinnerFrame = ((entry.spinnerFrame ?? 0) + 1) % 10;
          }
        }
      }
      this.requestRender();
    }, 80);
  }

  private stopTodoLoadingAnimation(): void {
    if (!this.todoLoadingTimer) return;
    clearInterval(this.todoLoadingTimer);
    this.todoLoadingTimer = undefined;
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
    const provider = getProvider(this.config, this.state.provider);
    const selector = new ModelSelector(
      provider.models,
      this.state.model,
      (modelId) => {
        this.closeModelSelector();
        this.setModel(modelId);
        this.showPrompt(`Model set to ${getModel(provider, modelId).name}`);
        this.requestRender();
      },
      () => {
        this.closeModelSelector();
        this.requestRender();
      },
      initialSearch,
    );
    this.modelSelector = selector;
    this.refreshChat();
    this.tui.setFocus(selector);
  }

  private closeModelSelector(): void {
    this.modelSelector = undefined;
    this.tui.setFocus(this.editor);
  }

  private showSessionSelector(): void {
    const sessions = listSessions().filter((s) => s.id !== this.currentSessionId);
    if (sessions.length === 0) {
      this.showPrompt("No saved sessions yet.");
      return;
    }
    const selector = new SessionSelector(
      sessions,
      (session: SessionRecord) => {
        this.closeSessionSelector();
        this.loadSessionRecord(session);
        this.showPrompt(`Loaded: ${session.title}`);
        this.requestRender();
      },
      () => {
        this.closeSessionSelector();
        this.requestRender();
      },
    );
    this.sessionSelector = selector;
    this.refreshChat();
    this.tui.setFocus(selector);
  }

  private closeSessionSelector(): void {
    this.sessionSelector = undefined;
    this.tui.setFocus(this.editor);
  }

  private showAskPrompt(id: string, questions: AskQuestion[]): void {
    const prompt = new AskPrompt(
      questions,
      (answers) => {
        this.closeAskPrompt();
        resolveAsk(id, answers);
        this.requestRender();
      },
      () => {
        this.closeAskPrompt();
        rejectAsk(id);
        this.requestRender();
      },
    );
    this.askPrompt = prompt;
    this.refreshChat();
    this.tui.setFocus(prompt);
  }

  private closeAskPrompt(): void {
    this.askPrompt = undefined;
    this.tui.setFocus(this.editor);
  }

  /**
   * 由主 agent tool call 触发，运行 explore subagent。
   * 结果通过 toolEntry 的 subagentId 关联，供 ctrl+o 打开详情。
   */
  private async runExploreSubagent(
    agent: RJSubagentConfig,
    task: string,
    toolEntry: ToolCallEntry,
  ): Promise<string> {
    const snapshot = createSubagentSnapshot(agent, task.slice(0, 80));
    const subagentId = `${agent.id}-${Date.now()}`;
    this.subagentSnapshots.set(subagentId, snapshot);
    toolEntry.subagentId = subagentId;

    const provider = getProvider(this.config, this.state.provider);
    const model = getModel(provider, this.state.model);

    // 当前 subagent assistant 消息及其当前 segment（与主 agent 结构完全一致）
    let subagentAssistant: Message | undefined;
    let subagentSegment: AssistantSegment | undefined;
    // 追踪每个 tool call entry，按 callId 索引
    const pendingEntries = new Map<string, ToolCallEntry>();
    const pendingSpinners = new Map<string, NodeJS.Timeout>();

    try {
      const result = await runSubagent(
        agent,
        task,
        provider,
        model.id,
        this.state.cwd,
        {
          onTurn: () => {
            // 每轮新建一个 assistant 消息（或复用已有的），追加新 segment
            if (!subagentAssistant) {
              subagentAssistant = { kind: "assistant", text: "", label: `${agent.name}[subagent]`, segments: [] };
              snapshot.messages.push(subagentAssistant);
            }
            subagentSegment = { text: "" };
            subagentAssistant.segments!.push(subagentSegment);
            this.requestRender();
          },
          onDelta: (delta) => {
            if (!subagentSegment) return;
            if (delta.thinking) subagentSegment.thinking = `${subagentSegment.thinking ?? ""}${delta.thinking}`;
            if (delta.content) {
              subagentSegment.text += delta.content;
              snapshot.fullOutput += delta.content;
            }
            this.requestRender();
          },
          onToolCall: (callId, toolName, callLabel) => {
            if (!subagentSegment) return;
            const entry: ToolCallEntry = { id: callId, name: toolName, status: "running", callLabel, spinnerFrame: 0 };
            subagentSegment.toolCalls = [...(subagentSegment.toolCalls ?? []), entry];
            pendingEntries.set(callId, entry);
            const timer = setInterval(() => {
              entry.spinnerFrame = ((entry.spinnerFrame ?? 0) + 1) % 10;
              this.requestRender();
            }, 80);
            pendingSpinners.set(callId, timer);
            this.requestRender();
          },
          onToolResult: (callId, label, isError) => {
            const entry = pendingEntries.get(callId);
            if (entry) {
              entry.status = isError ? "error" : "completed";
              entry.resultLabel = label;
              entry.isError = isError;
            }
            const timer = pendingSpinners.get(callId);
            if (timer) { clearInterval(timer); pendingSpinners.delete(callId); }
            this.requestRender();
          },
          onSummaryTurn: () => {
            // 总结阶段新建一个 user 消息作为分隔，再新建 assistant 消息承载总结
            snapshot.messages.push({ kind: "user", text: "Summary", label: "summary" });
            subagentAssistant = { kind: "assistant", text: "", label: `${agent.name}[subagent]`, segments: [] };
            snapshot.messages.push(subagentAssistant);
            subagentSegment = { text: "" };
            subagentAssistant.segments!.push(subagentSegment);
            this.requestRender();
          },
          onSummaryDelta: (delta) => {
            if (!subagentSegment) return;
            if (delta.content) subagentSegment.text += delta.content;
            this.requestRender();
          },
        },
      );

      // 清理所有残留 spinner
      for (const timer of pendingSpinners.values()) clearInterval(timer);
      pendingSpinners.clear();

      snapshot.status = "done";
      snapshot.fullOutput = result.fullOutput;
      snapshot.toolEntries = result.toolEntries;
      snapshot.title = result.title;
      toolEntry.callLabel = result.title || task.slice(0, 60);
      toolEntry.resultLabel = `${result.toolEntries.length} files read`;
      this.requestRender();
      return result.summary;
    } catch (err) {
      for (const timer of pendingSpinners.values()) clearInterval(timer);
      pendingSpinners.clear();
      const msg = err instanceof Error ? err.message : String(err);
      snapshot.status = "error";
      snapshot.errorMessage = msg;
      toolEntry.resultLabel = msg.slice(0, 40);
      snapshot.messages.push({ kind: "error", text: msg, label: "error" });
      this.requestRender();
      return `Explore failed: ${msg}`;
    }
  }

  /** ctrl+o：在主消息列表位置打开最近一个 explore subagent 详情 */
  private openSubagentView(): void {
    if (this.openSubagentId) return;

    // 从 assistant 消息的 toolCalls 中找最近一个 explore entry
    let targetId: string | undefined;
    outer: for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg?.kind !== "assistant" || !msg.segments) continue;
      for (let s = msg.segments.length - 1; s >= 0; s--) {
        const toolCalls = msg.segments[s]?.toolCalls;
        if (!toolCalls) continue;
        for (let t = toolCalls.length - 1; t >= 0; t--) {
          const tc = toolCalls[t];
          if (tc?.name === "explore" && tc.subagentId) {
            targetId = tc.subagentId;
            break outer;
          }
        }
      }
    }
    if (!targetId) return;

    const snapshot = this.subagentSnapshots.get(targetId);
    if (!snapshot) return;

    this.openSubagentId = targetId;
    this.tui.setFocus(null);
    this.requestRender();
  }

  private closeSubagentViewFromEscape(): void {
    this.suppressEscapeCancelUntil = Date.now() + 250;
    this.closeSubagentView();
    this.requestRender();
  }

  private closeSubagentView(): void {
    this.openSubagentId = undefined;
    this.tui.setFocus(this.editor);
  }

  private loadSessionRecord(session: SessionRecord): void {
    this.persistSession();
    this.messages = session.uiMessages;
    this.sessionMessages = session.sessionMessages;
    this.currentSessionId = session.id;
    this.currentSessionTitle = session.title;
    this.state.messageCount = this.messages.filter((m) => m.kind === "user" || m.kind === "assistant").length;
    this.updateContextUsage();
  }

  private persistSession(): void {
    if (this.sessionMessages.length === 0) return;
    saveSession(this.currentSessionId, this.sessionMessages, this.messages, this.state.startedAt, this.currentSessionTitle);
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
    const subagentSnapshot = this.openSubagentId ? this.subagentSnapshots.get(this.openSubagentId) : undefined;
    this.header.setText(subagentSnapshot ? subagentHeaderText(subagentSnapshot) : headerText());
    this.input.clear();
    if (!subagentSnapshot) {
      this.input.addChild(new Spacer(1));
      this.input.addChild(this.editor);
    }
    this.chat.clear();
    if (this.modelSelector) {
      this.chat.addChild(this.modelSelector);
    } else if (this.sessionSelector) {
      this.chat.addChild(this.sessionSelector);
    } else {
      const messages = subagentSnapshot ? subagentSnapshot.messages : this.messages;
      this.chat.addChild(new MessagesView(() => messages));
      if (this.askPrompt) {
        this.chat.addChild(new Spacer(1));
        this.chat.addChild(this.askPrompt);
      }
    }
  }

  private requestRender(): void {
    this.refreshChat();
    this.root.invalidate();
    this.tui.requestRender();
  }
}

/**
 * 启动交互式 TUI 应用。
 */
export const startInteractiveApp = async (): Promise<void> => {
  const app = new RJApp();
  await app.start();
};

/**
 * 生成 --help 输出文本。
 */
export const getHelpOutput = (): string =>
  [
    "RJ v0.1.0",
    "",
    "Usage:",
    "  rj                 Start interactive TUI",
    "  rj --help          Show help",
    "  rj --version       Show version",
    "",
    helpText(),
  ].join("\n");
