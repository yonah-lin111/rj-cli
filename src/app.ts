import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import {
  Container, Editor, Loader, ProcessTerminal, Spacer, Text, TUI,
  matchesKey, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS,
} from "@mariozechner/pi-tui";
import { runBash, runBashTool } from "./tools/base/bash.ts";
import { writeFileTool, editFileTool, readFileTool, type FileEdit } from "./tools/base/file-writer.ts";
import { todoWriteTool } from "./tools/base/todo.ts";
import { streamChat, type ChatHistoryMessage, type ToolCall, type ToolResult, writeFileTool as writeFileSchema, editFileTool as editFileSchema, readFileToolSchema, bashToolSchema, todoWriteToolSchema, rjGetRankingSchema, rjQuerySchema, rjGetDetailSchema, rjGetOverviewSchema, askToolSchema, exploreToolSchema, rjWorkOpsPreviewSchema, rjWorkOpsProcessSchema } from "./core/ai.ts";
import { getRankingTool, queryRjTool, getRjDetailTool, getOverviewTool } from "./tools/rj-server/index.ts";
import { previewWorkOps, processWorkOps, type WorkOpsPreviewArgs, type WorkOpsProcessArgs } from "./tools/rj-server/work-ops.ts";
import {
  formatContextWindow, getModel, getProvider, loadConfig, loadPromptHistory,
  saveDefaultModel, savePromptHistory,
} from "./core/config.ts";
import { AppState, createInitialState } from "./core/state.ts";
import { executeSlashCommand, getCommands, helpText, type AppCommandContext } from "./core/commands.ts";
import { Footer } from "./ui/footer.ts";
import { headerText, subagentHeaderText } from "./ui/header.ts";
import { ModelSelector } from "./ui/model-selector.ts";
import { RankSelector, type RankSelection } from "./ui/rank-selector.ts";
import { SessionSelector } from "./ui/session-selector.ts";
import { SubagentSelector } from "./ui/subagent-selector.ts";
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

type OpenUrlCommand = {
  command: string;
  label: string;
};

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
  private rankSelector?: RankSelector;
  private rankPageServer?: Server;
  private openUrlCommand?: OpenUrlCommand;
  private sessionSelector?: SessionSelector;
  private subagentSelector?: SubagentSelector;
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
  private ignoreNextSigint = false;
  private ignoreNextSigintTimer?: NodeJS.Timeout;
  private ignoreNextCtrlC = false;
  private ignoreNextCtrlCTimer?: NodeJS.Timeout;
  private state: AppState = createInitialState(this.config);

  async start(): Promise<void> {
    this.openUrlCommand = this.detectOpenUrlCommand();
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
    this.rankPageServer?.close();
    this.clearIgnoredSigint();
    this.clearIgnoredCtrlC();
    this.tui.stop();
    process.exit(exitCode);
  }

  private detectOpenUrlCommand(): OpenUrlCommand {
    if (process.platform === "darwin") {
      return { command: "open", label: "open" };
    }
    if (process.platform === "win32") {
      return { command: "start", label: "start" };
    }
    return { command: "xdg-open", label: "xdg-open" };
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
        if (this.ignoreNextCtrlC) {
          this.clearIgnoredCtrlC();
          return { consume: true };
        }
        if (this.clearEditorForCtrlC()) {
          this.suppressNextSigint();
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

      if (this.rankSelector) {
        this.rankSelector.handleInput(data);
        this.requestRender();
        return { consume: true };
      }

      if (this.sessionSelector) {
        this.sessionSelector.handleInput(data);
        this.requestRender();
        return { consume: true };
      }

      if (this.subagentSelector) {
        if (matchesKey(data, "escape")) {
          this.closeSubagentSelector();
          this.requestRender();
          return { consume: true };
        }
        this.subagentSelector.handleInput(data);
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
      if (this.ignoreNextSigint) {
        this.clearIgnoredSigint();
        return;
      }
      if (this.clearEditorForCtrlC()) {
        this.suppressNextCtrlC();
        return;
      }
      this.stop(0);
    });
    process.on("SIGTERM", () => this.stop(0));
  }

  private clearEditorForCtrlC(): boolean {
    if (this.editor.getText().length === 0) {
      return false;
    }
    this.editor.setText("");
    this.requestRender();
    return true;
  }

  private suppressNextSigint(): void {
    this.ignoreNextSigint = true;
    if (this.ignoreNextSigintTimer) {
      clearTimeout(this.ignoreNextSigintTimer);
    }
    this.ignoreNextSigintTimer = setTimeout(() => this.clearIgnoredSigint(), 100);
  }

  private clearIgnoredSigint(): void {
    this.ignoreNextSigint = false;
    if (this.ignoreNextSigintTimer) {
      clearTimeout(this.ignoreNextSigintTimer);
      this.ignoreNextSigintTimer = undefined;
    }
  }

  private suppressNextCtrlC(): void {
    this.ignoreNextCtrlC = true;
    if (this.ignoreNextCtrlCTimer) {
      clearTimeout(this.ignoreNextCtrlCTimer);
    }
    this.ignoreNextCtrlCTimer = setTimeout(() => this.clearIgnoredCtrlC(), 100);
  }

  private clearIgnoredCtrlC(): void {
    this.ignoreNextCtrlC = false;
    if (this.ignoreNextCtrlCTimer) {
      clearTimeout(this.ignoreNextCtrlCTimer);
      this.ignoreNextCtrlCTimer = undefined;
    }
  }

  private async handleSubmit(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) return;
    this.editor.addToHistory(text);

    const isSingleLine = !/[\r\n]/.test(rawText);
    if (isSingleLine && text.startsWith("/") && /^\/[^\s/]+(\s|$)/.test(text)) {
      if (this.promptHistory.at(-1) !== text) {
        this.promptHistory.push(text);
        savePromptHistory(this.promptHistory);
      }
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
        tools: [writeFileSchema, editFileSchema, readFileToolSchema, bashToolSchema, todoWriteToolSchema, rjGetRankingSchema, rjQuerySchema, rjGetDetailSchema, rjGetOverviewSchema, askToolSchema, exploreToolSchema, rjWorkOpsPreviewSchema, rjWorkOpsProcessSchema],
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
              } else if (call.name === "rj_work_ops_preview") {
                const result = previewWorkOps(args as unknown as WorkOpsPreviewArgs);
                resultText = JSON.stringify(result, null, 2);
                isError = !result.success;
                entry.resultLabel = result.success ? `Preview: ${result.rj_code ?? ""}` : "Preview failed";
                entry.resultText = resultText;
              } else if (call.name === "rj_work_ops_process") {
                entry.resultLabel = "Processing...";
                clearInterval(spinnerTimer);
                this.requestRender();
                const events: string[] = [];
                try {
                  for await (const event of processWorkOps(args as unknown as WorkOpsProcessArgs)) {
                    const line = `[${event.step}] ${event.message}${event.progress !== undefined ? ` (${event.progress}/${event.total})` : ""}`;
                    events.push(line);
                    entry.resultText = events.join("\n");
                    entry.resultLabel = event.step === "done" ? "Done" : `Processing: ${event.step}`;
                    this.requestRender();
                    if (event.step === "error") {
                      isError = true;
                      entry.resultLabel = "处理失败";
                    }
                  }
                  resultText = events.join("\n");
                } catch (e) {
                  resultText = `处理异常: ${e instanceof Error ? e.message : String(e)}`;
                  isError = true;
                  entry.resultLabel = "处理失败";
                  entry.resultText = resultText;
                }
              } else if (call.name === "explore") {
                const task = typeof args.task === "string" ? args.task : "Explore files";
                const reuseMode = args.reuseMode === "reuse" || args.reuseMode === "new" ? args.reuseMode : "auto";
                const subagentId = typeof args.subagentId === "string" ? args.subagentId : undefined;
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
                  const subagentResult = await this.runExploreSubagent(exploreAgent, task, entry, { reuseMode, subagentId });
                  clearInterval(exploreSpinner);
                  resultText = subagentResult.content;
                  isError = subagentResult.isError;
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
                    .map((ans, i) => `${questions[i]?.header ?? ""}:${ans.join(", ")}`)
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
    this.requestRender();
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
      this.subagentSnapshots.clear();
      this.openSubagentId = undefined;
      this.subagentSelector = undefined;
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

    if (action.type === "show-rank-selector") {
      this.showRankSelector();
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

    if (action.type === "fill-input") {
      this.editor.setText(action.text);
      if (action.cursorCol !== undefined) {
        // setText 后光标在末尾，发送左箭头将光标移到 ] 前
        const currentLen = action.text.length;
        const moves = currentLen - action.cursorCol;
        for (let i = 0; i < moves; i++) {
          this.editor.handleInput("\x1b[D");
        }
      }
      this.requestRender();
      return;
    }

    if (action.type === "chat") {
      void this.handleChat(action.text);
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

  private showRankSelector(): void {
    const selector = new RankSelector(
      (selection) => {
        this.closeRankSelector();
        void this.handleRankSelection(selection);
      },
      () => {
        this.closeRankSelector();
        this.requestRender();
      },
    );
    this.rankSelector = selector;
    this.refreshChat();
    this.tui.setFocus(selector);
  }

  private closeRankSelector(): void {
    this.rankSelector = undefined;
    this.tui.setFocus(this.editor);
  }

  private async handleRankSelection(selection: RankSelection): Promise<void> {
    const periodNames: Record<RankSelection["rankingType"], string> = {
      "24h": "天",
      "7d": "周",
      "30d": "月",
      year: "年",
    };

    if (selection.openPage) {
      await this.openRankPage(selection);
      return;
    }

    const text = `请输出 RJ ${periodNames[selection.rankingType]}排行榜前 ${selection.pageSize} 条：
1. 调用 rj_get_ranking，参数 ranking_type="${selection.rankingType}"、page=1、page_size=${selection.pageSize}
2. 将返回 items 渲染为 Markdown 表格，列包含 排名、RJ号、标题、社团、CV、发售日
3. 只在回复中输出表格，不导出文件`;
    await this.handleChat(text);
  }

  private async openRankPage(selection: RankSelection): Promise<void> {
    const server = await this.startRankPageServer();
    const address = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}/?ranking_type=${encodeURIComponent(selection.rankingType)}&page_size=${selection.pageSize}`;
    const opener = this.openUrlCommand ?? this.detectOpenUrlCommand();
    this.openUrlCommand = opener;
    await this.handleChat(`请使用 bash 工具打开 RJ 排行榜页面，并在命令执行后简短说明页面已打开，支持分页、排行周期切换以及 RJ号/标题/社团/CV 条件查询。

要求：
1. 当前系统打开命令是 ${opener.command}
2. 页面地址是 ${url}
3. 只调用一次 bash 工具打开页面
4. 命令中必须安全引用 URL，不要拼接未转义的参数
5. bash 完成后简短回复打开结果`);
  }

  private async startRankPageServer(): Promise<Server> {
    if (this.rankPageServer?.listening) return this.rankPageServer;

    const server = createServer((req, res) => {
      void this.handleRankPageRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.rankPageServer = server;
    return server;
  }

  private async handleRankPageRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      this.sendRankPageHtml(res);
      return;
    }
    if (url.pathname === "/api/ranking") {
      await this.sendRankPageData(url, res);
      return;
    }
    this.sendJson(res, { error: "Not found" }, 404);
  }

  private async sendRankPageData(url: URL, res: ServerResponse): Promise<void> {
    const rankingType = this.parseRankingType(url.searchParams.get("ranking_type"));
    const page = this.parsePositiveInt(url.searchParams.get("page"), 1, 1, 1000);
    const pageSize = this.parsePositiveInt(url.searchParams.get("page_size"), 20, 5, 100);
    const result = await getRankingTool({
      ranking_type: rankingType,
      page,
      page_size: pageSize,
      rj_code: url.searchParams.get("rj_code")?.trim() || undefined,
      title: url.searchParams.get("title")?.trim() || undefined,
      circle: url.searchParams.get("circle")?.trim() || undefined,
      cv: url.searchParams.get("cv")?.trim() || undefined,
    });
    if (result.isError) {
      this.sendJson(res, { error: result.content }, 500);
      return;
    }
    this.sendJson(res, JSON.parse(result.content));
  }

  private parseRankingType(value: string | null): RankSelection["rankingType"] {
    if (value === "7d" || value === "30d" || value === "year") return value;
    return "24h";
  }

  private parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  private sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  }

  private sendRankPageHtml(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RJ 排行榜</title>
  <style>
    :root { color-scheme: dark; --bg: #0f172a; --panel: #111827; --line: #243044; --text: #e5e7eb; --muted: #94a3b8; --accent: #38bdf8; --danger: #fb7185; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1 { margin: 0 0 18px; font-size: 24px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 16px; box-shadow: 0 16px 50px rgba(0, 0, 0, .24); }
    .filters { display: grid; grid-template-columns: repeat(6, minmax(140px, 1fr)); gap: 12px; align-items: end; margin-bottom: 16px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
    input, select, button { height: 36px; border-radius: 8px; border: 1px solid var(--line); background: #0b1220; color: var(--text); padding: 0 10px; font-size: 14px; }
    button { cursor: pointer; background: #0e7490; border-color: #0891b2; font-weight: 600; }
    button.secondary { background: #1f2937; border-color: #334155; }
    .summary { margin: 8px 0 12px; color: var(--muted); font-size: 13px; }
    .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: 1120px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 13px; }
    th { position: sticky; top: 0; background: #111827; color: #cbd5e1; white-space: nowrap; }
    tr:hover td { background: rgba(56, 189, 248, .06); }
    a { color: var(--accent); text-decoration: none; }
    .thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; background: #020617; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; max-width: 260px; }
    .tag { padding: 2px 6px; border-radius: 999px; background: #1e293b; color: #cbd5e1; font-size: 12px; }
    .pager { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 14px; color: var(--muted); }
    .error { color: var(--danger); }
    @media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(140px, 1fr)); } }
  </style>
</head>
<body>
  <h1>RJ 排行榜</h1>
  <main class="panel">
    <section class="filters">
      <label>排行
        <select id="ranking_type">
          <option value="24h">天</option>
          <option value="7d">周</option>
          <option value="30d">月</option>
          <option value="year">年</option>
        </select>
      </label>
      <label>RJ号 <input id="rj_code" placeholder="输入 RJ 号"></label>
      <label>标题 <input id="title" placeholder="模糊查询标题"></label>
      <label>社团 <input id="circle" placeholder="模糊查询社团"></label>
      <label>CV <input id="cv" placeholder="模糊查询 CV"></label>
      <label>每页
        <select id="page_size">
          <option>5</option><option>10</option><option>15</option><option>20</option><option>25</option><option>30</option><option>40</option><option>60</option><option>100</option>
        </select>
      </label>
      <button id="search">查询</button>
      <button id="reset" class="secondary">重置</button>
    </section>
    <div id="summary" class="summary">加载中...</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>排名</th><th>封面</th><th>RJ号</th><th>标题</th><th>社团</th><th>CV</th><th>标签</th><th>全年龄</th><th>发售日</th></tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <section class="pager">
      <button id="prev" class="secondary">上一页</button>
      <span id="page_info"></span>
      <button id="next" class="secondary">下一页</button>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const state = { page: 1, total: 0 };
    const ids = ["ranking_type", "rj_code", "title", "circle", "cv", "page_size"];
    const el = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    el.ranking_type.value = params.get("ranking_type") || "24h";
    el.page_size.value = params.get("page_size") || "20";

    const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const link = (href, text) => href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer">' + escapeHtml(text) + '</a>' : escapeHtml(text);

    async function loadRanking() {
      const query = new URLSearchParams({ ranking_type: el.ranking_type.value, page: String(state.page), page_size: el.page_size.value });
      for (const key of ["rj_code", "title", "circle", "cv"]) {
        if (el[key].value.trim()) query.set(key, el[key].value.trim());
      }
      history.replaceState(null, "", "?" + query.toString());
      document.getElementById("summary").textContent = "加载中...";
      const response = await fetch("/api/ranking?" + query.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      state.total = data.total || 0;
      renderRows(data.items || []);
      renderPager();
      document.getElementById("summary").textContent = data.ranking_type + " 排行榜，共 " + state.total + " 条";
    }

    function renderRows(items) {
      const tbody = document.getElementById("rows");
      tbody.innerHTML = items.map(item => '<tr>' +
        '<td>' + escapeHtml(item.rank ?? "-") + '</td>' +
        '<td>' + (item.thumbnail ? '<img class="thumb" src="' + escapeHtml(item.thumbnail) + '" loading="lazy">' : '') + '</td>' +
        '<td>' + escapeHtml(item.rj_code) + '</td>' +
        '<td>' + link(item.title_url, item.title) + '</td>' +
        '<td>' + link(item.circle_url, item.circle || "") + '</td>' +
        '<td>' + escapeHtml(item.cv || "") + '</td>' +
        '<td><div class="tags">' + (item.tags || []).map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div></td>' +
        '<td>' + (item.is_all_ages ? '是' : '否') + '</td>' +
        '<td>' + escapeHtml(item.release_date || "") + '</td>' +
      '</tr>').join('');
      if (!items.length) tbody.innerHTML = '<tr><td colspan="9">暂无数据</td></tr>';
    }

    function renderPager() {
      const pageSize = Number(el.page_size.value);
      const pages = Math.max(1, Math.ceil(state.total / pageSize));
      document.getElementById("page_info").textContent = state.page + " / " + pages;
      document.getElementById("prev").disabled = state.page <= 1;
      document.getElementById("next").disabled = state.page >= pages;
    }

    let timer;
    function debouncedSearch() {
      clearTimeout(timer);
      timer = setTimeout(() => { state.page = 1; loadRanking().catch(showError); }, 300);
    }
    function showError(error) {
      document.getElementById("summary").innerHTML = '<span class="error">' + escapeHtml(error.message || error) + '</span>';
    }

    document.getElementById("search").onclick = () => { state.page = 1; loadRanking().catch(showError); };
    document.getElementById("reset").onclick = () => {
      el.ranking_type.value = "24h";
      el.rj_code.value = "";
      el.title.value = "";
      el.circle.value = "";
      el.cv.value = "";
      state.page = 1;
      loadRanking().catch(showError);
    };
    document.getElementById("prev").onclick = () => { if (state.page > 1) { state.page--; loadRanking().catch(showError); } };
    document.getElementById("next").onclick = () => { state.page++; loadRanking().catch(showError); };
    ids.forEach(id => el[id].addEventListener(id === "page_size" || id === "ranking_type" ? "change" : "input", debouncedSearch));
    loadRanking().catch(showError);
  </script>
</body>
</html>`);
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
    options: { reuseMode: "auto" | "reuse" | "new"; subagentId?: string },
  ): Promise<{ content: string; isError: boolean }> {
    const resolved = this.resolveSubagentSnapshot(agent, task, options.reuseMode, options.subagentId);
    if ("error" in resolved) {
      toolEntry.status = "error";
      toolEntry.resultLabel = resolved.error;
      toolEntry.isError = true;
      return { content: resolved.error, isError: true };
    }

    const { snapshot, action } = resolved;
    const previousFullOutput = snapshot.fullOutput;
    const now = new Date().toISOString();
    snapshot.status = "running";
    snapshot.updatedAt = now;
    snapshot.lastRunAt = now;
    snapshot.errorMessage = undefined;
    if (action === "reuse") snapshot.messages.push({ kind: "user", text: task, label: "main" });
    toolEntry.subagentId = snapshot.id;
    toolEntry.subagentAction = action;
    toolEntry.subagentAgentId = agent.id;
    toolEntry.callLabel = `${action === "new" ? "New" : "Reuse"}: ${task.slice(0, 52)}`;

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
        this.activeAIAbort?.signal,
        snapshot.conversationHistory,
      );

      // 清理所有残留 spinner
      for (const timer of pendingSpinners.values()) clearInterval(timer);
      pendingSpinners.clear();

      const finishedAt = new Date().toISOString();
      snapshot.status = "done";
      snapshot.fullOutput = previousFullOutput + result.fullOutput;
      snapshot.toolEntries = [...snapshot.toolEntries, ...result.toolEntries];
      snapshot.title = result.title;
      snapshot.conversationHistory = result.conversationHistory;
      snapshot.runCount += 1;
      snapshot.updatedAt = finishedAt;
      snapshot.lastRunAt = finishedAt;
      toolEntry.callLabel = `${action === "new" ? "New" : "Reuse"}: ${result.title || task.slice(0, 52)}`;
      toolEntry.resultLabel = `${result.toolEntries.length} files read`;
      toolEntry.subagentTitle = snapshot.title;
      this.requestRender();
      return { content: result.summary, isError: false };
    } catch (err) {
      for (const timer of pendingSpinners.values()) clearInterval(timer);
      pendingSpinners.clear();
      const msg = err instanceof Error ? err.message : String(err);
      snapshot.status = "error";
      snapshot.errorMessage = msg;
      snapshot.updatedAt = new Date().toISOString();
      toolEntry.resultLabel = msg.slice(0, 40);
      snapshot.messages.push({ kind: "error", text: msg, label: "error" });
      this.requestRender();
      return { content: `Explore failed: ${msg}`, isError: true };
    }
  }

  private resolveSubagentSnapshot(
    agent: RJSubagentConfig,
    task: string,
    reuseMode: "auto" | "reuse" | "new",
    subagentId?: string,
  ): { snapshot: SubagentSnapshot; action: "new" | "reuse" } | { error: string } {
    if (subagentId) {
      const snapshot = this.subagentSnapshots.get(subagentId);
      if (!snapshot) return { error: `Subagent not found: ${subagentId}` };
      if (snapshot.agentId !== agent.id) return { error: `Subagent ${subagentId} belongs to ${snapshot.agentId}, not ${agent.id}.` };
      if (snapshot.status === "running") return { error: `Subagent ${subagentId} is busy.` };
      if (reuseMode === "new") return this.createResolvedSubagentSnapshot(agent, task);
      return { snapshot, action: "reuse" };
    }

    if (reuseMode === "new") return this.createResolvedSubagentSnapshot(agent, task);

    const reusable = [...this.subagentSnapshots.values()]
      .filter((snapshot) => snapshot.agentId === agent.id && snapshot.status !== "running")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
    if (reusable) return { snapshot: reusable, action: "reuse" };
    if (reuseMode === "reuse") return { error: `No reusable ${agent.name} subagent is available.` };
    return this.createResolvedSubagentSnapshot(agent, task);
  }

  private createResolvedSubagentSnapshot(
    agent: RJSubagentConfig,
    task: string,
  ): { snapshot: SubagentSnapshot; action: "new" } {
    const id = `${agent.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const snapshot = createSubagentSnapshot(agent, task.slice(0, 80), id);
    this.subagentSnapshots.set(id, snapshot);
    return { snapshot, action: "new" };
  }

  /** ctrl+o：打开 subagent 选择面板 */
  private openSubagentView(): void {
    if (this.openSubagentId) return;
    this.showSubagentSelector();
  }

  private showSubagentSelector(): void {
    const snapshots = [...this.subagentSnapshots.values()];
    if (snapshots.length === 0) {
      this.showPrompt("No subagents in this session.");
      return;
    }
    if (snapshots.length === 1) {
      this.openSubagentId = snapshots[0]!.id;
      this.tui.setFocus(null);
      this.requestRender();
      return;
    }
    const selector = new SubagentSelector(
      snapshots,
      (snapshot) => {
        this.closeSubagentSelector();
        this.openSubagentId = snapshot.id;
        this.tui.setFocus(null);
        this.requestRender();
      },
      () => {
        this.closeSubagentSelector();
        this.requestRender();
      },
    );
    this.subagentSelector = selector;
    this.tui.setFocus(selector);
    this.requestRender();
  }

  private closeSubagentSelector(): void {
    this.subagentSelector = undefined;
    this.tui.setFocus(this.editor);
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
    this.subagentSnapshots = new Map((session.subagentSnapshots ?? []).map((snapshot) => [snapshot.id, snapshot]));
    this.openSubagentId = undefined;
    this.subagentSelector = undefined;
    this.currentSessionId = session.id;
    this.currentSessionTitle = session.title;
    this.state.messageCount = this.messages.filter((m) => m.kind === "user" || m.kind === "assistant").length;
    this.updateContextUsage();
  }

  private persistSession(): void {
    if (this.sessionMessages.length === 0) return;
    saveSession(
      this.currentSessionId,
      this.sessionMessages,
      this.messages,
      this.state.startedAt,
      this.currentSessionTitle,
      Array.from(this.subagentSnapshots.values()),
    );
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
    } else if (this.rankSelector) {
      this.chat.addChild(this.rankSelector);
    } else if (this.sessionSelector) {
      this.chat.addChild(this.sessionSelector);
    } else if (this.subagentSelector) {
      this.chat.addChild(this.subagentSelector);
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
