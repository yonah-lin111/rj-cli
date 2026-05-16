import { type AddressInfo } from "node:net";
import type { Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Container, Editor, Loader, ProcessTerminal, Spacer, Text, TUI,
  getKeybindings,
  matchesKey, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS,
} from "@mariozechner/pi-tui";
import type { KeybindingsManager as TUIKeybindingsManager } from "@mariozechner/pi-tui";
import { runBash, runBashTool } from "./tools/base/bash.ts";
import { writeFileTool, editFileTool, readFileTool, type FileEdit } from "./tools/base/file-writer.ts";
import { todoWriteTool } from "./tools/base/todo.ts";
import { streamChat, type ChatHistoryMessage, type ToolCall, type ToolResult, writeFileTool as writeFileSchema, editFileTool as editFileSchema, readFileToolSchema, bashToolSchema, todoWriteToolSchema, rjGetRankingSchema, rjQuerySchema, circleQuerySchema, circleGetDetailSchema, circleUpdateSchema, circleQueryWorksSchema, circleAddWorkSchema, circleRemoveWorkSchema, circleGetLatestWorksSchema, rjGetDetailSchema, rjGetOverviewSchema, rjAddSchema, rjRemoveSchema, rjCheckExistsSchema, circleAddSchema, circleRemoveSchema, circleCheckExistsSchema, worksListSchema, worksDeleteSchema, worksUpdateStatusSchema, circleListSchema, circleGetSchema, circleDeleteSchema, circleWorksListSchema, circleWorkRemoveSchema, circleLatestWorksListSchema, circleLatestWorkAddSchema, rankListSchema, rankAddWorkSchema, rankRemoveWorkSchema, rankAddCircleSchema, rankRemoveCircleSchema, askToolSchema, exploreToolSchema, rjWorkOpsPreviewSchema, rjWorkOpsProcessSchema, matchMegaResourcesSchema, matchAsmroOneResourcesSchema } from "./core/ai.ts";
import { getRankingTool, queryRjTool, queryCircleTool, getCircleDetailTool, updateCircleTool, queryCircleWorksTool, addWorkToCircleTool, removeWorkFromCircleTool, getCircleLatestWorksTool, getRjDetailTool, getOverviewTool, addRjFromRankingTool, removeRjTool, checkRjExistsTool, addCircleTool, removeCircleTool, checkCircleExistsTool, worksListTool, worksDeleteTool, worksUpdateStatusTool, circleListTool, circleGetTool, circleDeleteTool, circleWorksListTool, circleWorkRemoveTool, circleLatestWorksListTool, circleLatestWorkAddTool, rankListTool, rankAddWorkTool, rankRemoveWorkTool, rankAddCircleTool, rankRemoveCircleTool, matchMegaResourcesTool, matchAsmroOneResourcesTool, type ResourceMatchSelection } from "./tools/rj-server/index.ts";
import { previewWorkOps, processWorkOps, type WorkOpsPreviewArgs, type WorkOpsProcessArgs } from "./tools/rj-server/work-ops.ts";
import {
  executeUploadMegaFile,
  planUploadMegaFile,
  type UploadMegaFilePlan,
} from "./tools/local/upload-mega-file.ts";
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
import { ResourceMatchSelector } from "./ui/resource-match-selector.ts";
import { CircleSelector, type CircleSelection } from "./ui/circle-selector.ts";
import { WorksSelector, type WorksSelection } from "./ui/works-selector.ts";
import { SessionSelector } from "./ui/session-selector.ts";
import { SubagentSelector } from "./ui/subagent-selector.ts";
import { AskPrompt } from "./ui/ask-prompt.ts";
import { createAskId, registerAskPending, resolveAsk, rejectAsk, formatAskResult, type AskQuestion } from "./tools/base/ask.ts";
import { MessagesView, type Message, type AssistantSegment, type ToolCallEntry } from "./ui/messages.ts";
import { editorTheme, theme } from "./ui/theme.ts";
import { expandAtMentions } from "./tools/base/file-reader.ts";
import { RJAutocompleteProvider } from "./utils/autocomplete.ts";
import { generateSessionId, saveSession, listSessions, generateSessionTitle, type SessionRecord } from "./core/session.ts";
import { type SubagentSnapshot } from "./ui/subagent-view.ts";
import type { RJSubagentConfig } from "./core/config.ts";
import { buildChatHistory, calculateContextUsage, estimateContextTokens } from "./app/context-usage.ts";
import { createSessionSaveArgs, hydrateSessionState } from "./app/session-helpers.ts";
import { runExploreSubagentWithSnapshot } from "./app/subagent-runner.ts";
import { getToolCallLabel } from "./app/tool-labels.ts";
import { handleRankSelectionAction } from "./app/rank-actions.ts";
import { handleResourceMatchSelectionAction } from "./app/resource-match-actions.ts";
import { handleCircleSelectionAction, loadCircleSelectorItems } from "./app/circle-actions.ts";
import { handleWorksSelectionAction, loadWorksSelectorItems } from "./app/works-actions.ts";
import { type ChatSubmission } from "./app/command-prompts.ts";
import { detectOpenUrlCommand, ensureRankPageServer, type OpenUrlCommand } from "./app/open-url.ts";
import { findLastQAPair, trimLastSessionQA } from "./app/message-history.ts";

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
  private resourceMatchSelector?: ResourceMatchSelector;
  private resourceMatchMode?: "mega" | "asmrone";
  private circleSelector?: CircleSelector;
  private worksSelector?: WorksSelector;
  private rankPageServer?: Server;
  private viteProcess?: ChildProcess;
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
  private activeQA?: {
    user: Message;
    assistant?: Message;
    sessionStartIndex: number;
    promptText: string;
    restoreText: string;
  };
  private cancelledQA?: { sessionStartIndex: number };
  private pendingUndoPrompt?: string;
  private lastEscapeAt = 0;
  private suppressEscapeCancelUntil = 0;
  private suppressSelectorConfirmUntil = 0;
  private canConsumeSuppressedSelectorConfirm = false;
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

    const server = await ensureRankPageServer();
    this.rankPageServer = server;
    const address = server.address() as AddressInfo;

    if (process.env.RJ_WEB_DEV === "1") {
      const webDir = join(fileURLToPath(new URL(".", import.meta.url)), "../web");
      this.viteProcess = spawn("pnpm", ["dev"], {
        cwd: webDir,
        env: { ...process.env, VITE_API_PORT: String(address.port) },
        stdio: "ignore",
      });
    }
  }

  stop(exitCode = 0): void {
    if (this.stopped) return;
    this.stopped = true;
    this.rankPageServer?.close();
    this.viteProcess?.kill();
    this.clearIgnoredSigint();
    this.clearIgnoredCtrlC();
    this.tui.stop();
    process.exit(exitCode);
  }

  private detectOpenUrlCommand(): OpenUrlCommand {
    return detectOpenUrlCommand();
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

      if (this.shouldSuppressSelectorConfirm(data)) {
        return { consume: true };
      }

      if (this.rankSelector) {
        this.rankSelector.handleInput(data);
        this.requestRender();
        return { consume: true };
      }

      if (this.resourceMatchSelector) {
        this.resourceMatchSelector.handleInput(data);
        this.requestRender();
        return { consume: true };
      }

      if (this.circleSelector) {
        this.circleSelector.handleInput(data);
        this.requestRender();
        return { consume: true };
      }

      if (this.worksSelector) {
        this.worksSelector.handleInput(data);
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

  /** 打开 selector 后，短时吞掉一次残留确认键，避免 VSCode 终端重复消费 Enter。 */
  private armSelectorConfirmSuppression(): void {
    this.suppressSelectorConfirmUntil = Date.now() + 120;
    this.canConsumeSuppressedSelectorConfirm = true;
  }

  /** 判断当前是否存在会接收统一输入分发的 selector。 */
  private hasOpenSelector(): boolean {
    return Boolean(
      this.modelSelector ||
      this.rankSelector ||
      this.resourceMatchSelector ||
      this.circleSelector ||
      this.worksSelector ||
      this.sessionSelector ||
      this.subagentSelector,
    );
  }

  /** 判断是否需要吞掉 selector 打开瞬间残留的确认输入。 */
  private shouldSuppressSelectorConfirm(data: string): boolean {
    if (!this.hasOpenSelector()) return false;
    if (!this.matchesSelectorConfirm(data)) return false;
    if (!this.canConsumeSuppressedSelectorConfirm) return false;
    if (Date.now() >= this.suppressSelectorConfirmUntil) return false;
    this.canConsumeSuppressedSelectorConfirm = false;
    return true;
  }

  /** 统一判断当前输入是否命中 selector 确认键。 */
  private matchesSelectorConfirm(data: string): boolean {
    const kb = this.getTuiKeybindings();
    return kb.matches(data, "tui.select.confirm");
  }

  /** 读取当前 TUI 键位映射，供应用层统一判断 selector 交互。 */
  private getTuiKeybindings(): TUIKeybindingsManager {
    return getKeybindings() as TUIKeybindingsManager;
  }

  private async handleSubmit(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) return;

    const isSingleLine = !/[\r\n]/.test(rawText);
    if (isSingleLine && text.startsWith("/") && /^\/[^\s/]+(\s|$)/.test(text)) {
      if (this.handleSlash(text)) this.recordPromptHistory(text);
      return;
    }

    this.recordPromptHistory(text);

    if (text.startsWith("!")) {
      await this.handleBash(text);
      return;
    }

    await this.handleChat(text);
  }

  private recordPromptHistory(text: string): void {
    this.editor.addToHistory(text);
    if (this.promptHistory.at(-1) === text) return;
    this.promptHistory.push(text);
    savePromptHistory(this.promptHistory);
  }

  private async handleChat(text: string): Promise<void> {
    await this.submitChat({
      kind: "user",
      displayText: text,
      promptText: text,
      label: "user",
    });
  }

  private async submitChat(submission: ChatSubmission): Promise<void> {
    if (this.runningAI) {
      this.addMessage("warning", "An AI request is already running. Wait for it to finish.", "warning");
      this.requestRender();
      return;
    }

    const { expanded, warnings } = expandAtMentions(submission.promptText, this.state.cwd, this.config.fileReading);
    for (const warning of warnings) {
      this.addMessage("warning", warning, "warning");
    }

    const isFirstMessage = this.sessionMessages.length === 0;
    this.runningAI = true;
    const user = this.addMessage(submission.kind, submission.displayText, submission.label);
    if (submission.kind === "user" && expanded !== submission.displayText) user.expandedText = expanded;
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
      assistant = this.addMessage("assistant", "", "RJ");
      assistant.segments = [];
      this.activeQA = {
        user,
        assistant,
        sessionStartIndex,
        promptText: submission.promptText,
        restoreText: submission.displayText,
      };
      await streamChat({
        provider,
        model: model.id,
        messages: this.chatHistory(),
        maxTokens: model.outputLimit,
        tools: [writeFileSchema, editFileSchema, readFileToolSchema, bashToolSchema, todoWriteToolSchema, rjGetRankingSchema, rjQuerySchema, circleQuerySchema, circleGetDetailSchema, circleUpdateSchema, circleQueryWorksSchema, circleAddWorkSchema, circleRemoveWorkSchema, circleGetLatestWorksSchema, rjGetDetailSchema, rjGetOverviewSchema, rjAddSchema, rjRemoveSchema, rjCheckExistsSchema, circleAddSchema, circleRemoveSchema, circleCheckExistsSchema, worksListSchema, worksDeleteSchema, worksUpdateStatusSchema, circleListSchema, circleGetSchema, circleDeleteSchema, circleWorksListSchema, circleWorkRemoveSchema, circleLatestWorksListSchema, circleLatestWorkAddSchema, rankListSchema, rankAddWorkSchema, rankRemoveWorkSchema, rankAddCircleSchema, rankRemoveCircleSchema, askToolSchema, exploreToolSchema, rjWorkOpsPreviewSchema, rjWorkOpsProcessSchema, matchMegaResourcesSchema, matchAsmroOneResourcesSchema],
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

            callLabel = getToolCallLabel(call.name, args);

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
              } else if (call.name === "circle_query") {
                const result = queryCircleTool(args as Parameters<typeof queryCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_get_detail") {
                const result = getCircleDetailTool(args as unknown as Parameters<typeof getCircleDetailTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_update") {
                const result = updateCircleTool(args as unknown as Parameters<typeof updateCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_query_works") {
                const result = queryCircleWorksTool(args as unknown as Parameters<typeof queryCircleWorksTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_add_work") {
                const result = addWorkToCircleTool(args as unknown as Parameters<typeof addWorkToCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_remove_work") {
                const result = removeWorkFromCircleTool(args as unknown as Parameters<typeof removeWorkFromCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_get_latest_works") {
                const result = await getCircleLatestWorksTool(args as unknown as Parameters<typeof getCircleLatestWorksTool>[0]);
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
              } else if (call.name === "rj_add") {
                const result = await addRjFromRankingTool(args as unknown as Parameters<typeof addRjFromRankingTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rj_remove") {
                const result = removeRjTool(args as unknown as Parameters<typeof removeRjTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rj_check_exists") {
                const result = checkRjExistsTool(args as unknown as Parameters<typeof checkRjExistsTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_add") {
                const result = addCircleTool(args as unknown as Parameters<typeof addCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_remove") {
                const result = removeCircleTool(args as unknown as Parameters<typeof removeCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_check_exists") {
                const result = checkCircleExistsTool(args as unknown as Parameters<typeof checkCircleExistsTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "works_list") {
                const result = worksListTool(args as Parameters<typeof worksListTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "works_delete") {
                const result = worksDeleteTool(args as unknown as Parameters<typeof worksDeleteTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "works_update_status") {
                const result = worksUpdateStatusTool(args as unknown as Parameters<typeof worksUpdateStatusTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_list") {
                const result = circleListTool(args as Parameters<typeof circleListTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_get") {
                const result = circleGetTool(args as unknown as Parameters<typeof circleGetTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_delete") {
                const result = circleDeleteTool(args as unknown as Parameters<typeof circleDeleteTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_works_list") {
                const result = circleWorksListTool(args as unknown as Parameters<typeof circleWorksListTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_work_remove") {
                const result = circleWorkRemoveTool(args as unknown as Parameters<typeof circleWorkRemoveTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_latest_works_list") {
                const result = await circleLatestWorksListTool(args as unknown as Parameters<typeof circleLatestWorksListTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "circle_latest_work_add") {
                const result = await circleLatestWorkAddTool(args as unknown as Parameters<typeof circleLatestWorkAddTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rank_list") {
                const result = await rankListTool(args as Parameters<typeof rankListTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rank_add_work") {
                const result = await rankAddWorkTool(args as unknown as Parameters<typeof rankAddWorkTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rank_remove_work") {
                const result = rankRemoveWorkTool(args as unknown as Parameters<typeof rankRemoveWorkTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rank_add_circle") {
                const result = rankAddCircleTool(args as unknown as Parameters<typeof rankAddCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "rank_remove_circle") {
                const result = rankRemoveCircleTool(args as unknown as Parameters<typeof rankRemoveCircleTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "match_mega_resources") {
                const result = matchMegaResourcesTool(args as unknown as Parameters<typeof matchMegaResourcesTool>[0]);
                resultText = result.content;
                isError = result.isError;
                entry.resultLabel = result.resultLabel;
                entry.resultText = resultText;
              } else if (call.name === "match_asmrone_resources") {
                const result = await matchAsmroOneResourcesTool(args as unknown as Parameters<typeof matchAsmroOneResourcesTool>[0]);
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
                  entry.subagentToolCount = 0;
                  entry.subagentDetailLabel = `New: ${task.slice(0, 80)}`;
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
      void generateSessionTitle(provider, model.id, submission.promptText).then((title) => {
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
    return buildChatHistory(this.state.cwd, this.sessionMessages);
  }

  private updateContextUsage(): void {
    const tokens = estimateContextTokens(this.chatHistory());
    const usage = calculateContextUsage(tokens, this.state.contextWindow);
    this.state.contextTokens = usage.contextTokens;
    this.state.contextPercent = usage.contextPercent;
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
    const pair = findLastQAPair(this.messages);
    if (!pair) {
      this.showPrompt("No QA to undo.");
      return;
    }

    const userPrompt = this.messages[pair.userIndex]?.text ?? "";
    this.messages.splice(pair.userIndex, pair.assistantIndex - pair.userIndex + 1);
    this.removeLastSessionQA();
    this.state.messageCount = Math.max(0, this.state.messageCount - 2);
    this.updateContextUsage();
    this.editor.setText(userPrompt);
    this.showPrompt("Removed last QA.");
  }

  private removeLastSessionQA(): void {
    trimLastSessionQA(this.sessionMessages);
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

  private handleSlash(text: string): boolean {
    this.state.commandCount++;
    const context: AppCommandContext = { ...this.state };
    const action = executeSlashCommand(text, context);

    if (action.type === "quit") {
      this.stop(0);
      return true;
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
      return true;
    }

    if (action.type === "undo") {
      if (this.runningAI && this.activeQA) {
        const activeQA = this.activeQA;
        this.pendingUndoPrompt = activeQA.restoreText;
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
      return true;
    }

    if (action.type === "show-session-selector") {
      this.showSessionSelector();
      this.requestRender();
      return true;
    }

    if (action.type === "open-web-ui") {
      void this.openWebUI();
      return true;
    }

    if (action.type === "show-rank-selector") {
      this.showRankSelector();
      this.requestRender();
      return true;
    }

    if (action.type === "show-match-mega-selector") {
      this.showResourceMatchSelector("mega");
      this.requestRender();
      return true;
    }

    if (action.type === "show-match-asmrone-selector") {
      this.showResourceMatchSelector("asmrone");
      this.requestRender();
      return true;
    }

    if (action.type === "show-circle-selector") {
      this.showCircleSelector();
      this.requestRender();
      return true;
    }

    if (action.type === "show-works-selector") {
      this.showWorksSelector();
      this.requestRender();
      return true;
    }

    if (action.type === "show-model-selector") {
      this.showModelSelector(action.search);
      this.requestRender();
      return true;
    }

    if (action.type === "system-messages") {
      for (const message of action.messages) this.addMessage("system", message);
      this.requestRender();
      return true;
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
      return false;
    }

    if (action.type === "command-chat") {
      void this.submitChat({
        kind: "command",
        displayText: action.displayText,
        promptText: action.promptText,
        label: "command",
      });
      return true;
    }

    if (action.type === "upload-mega-file") {
      this.state.commandCount++;
      this.addMessage("command", action.displayText, "command");
      void this.handleUploadMegaFile(action.sourcePath);
      return true;
    }

    if (action.type === "confirm-upload-mega-file") {
      this.state.commandCount++;
      this.addMessage("command", action.displayText, "command");
      void this.handleLocalUploadMegaFileConfirm(action.questions, action.uploadPlan, action.cancelMessage);
      return true;
    }

    if (action.type === "chat") {
      void this.handleChat(action.text);
      return true;
    }

    for (const message of action.messages) this.showPrompt(message);
    this.requestRender();
    return true;
  }

  private async openWebUI(): Promise<void> {
    if (!this.openUrlCommand) {
      this.showPrompt("Open command is not available.");
      this.requestRender();
      return;
    }
    try {
      const server = await ensureRankPageServer(this.rankPageServer);
      this.rankPageServer = server;
      const address = server.address() as AddressInfo;
      runBash(`nohup ${this.openUrlCommand.command} http://127.0.0.1:${address.port}/rank >/dev/null 2>&1 &`)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.showPrompt(`Failed to open Web UI: ${message}`);
          this.requestRender();
        });
      this.showPrompt(`Opened Web UI: http://127.0.0.1:${address.port}/rank`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showPrompt(`Failed to prepare Web UI: ${message}`);
    }
    this.requestRender();
  }

  private async handleUploadMegaFile(sourcePath: string): Promise<void> {
    try {
      const plan = planUploadMegaFile(sourcePath);
      const result = executeUploadMegaFile(plan);
      this.addMessage("system", `Copied file to ${result.targetPath}`, "system");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addMessage("error", message, "error");
    }
    this.requestRender();
  }

  private async handleLocalUploadMegaFileConfirm(
    questions: AskQuestion[],
    uploadPlan: Pick<UploadMegaFilePlan, "sourcePath" | "targetPath">,
    cancelMessage: string,
  ): Promise<void> {
    try {
      const answers = await new Promise<string[][]>((resolve, reject) => {
        const id = createAskId();
        registerAskPending(id, resolve, reject);
        this.showAskPrompt(id, questions);
      });
      const confirmed = answers[0]?.[0] === "Replace file";
      if (!confirmed) {
        this.addMessage("system", cancelMessage, "system");
        this.requestRender();
        return;
      }

      const result = executeUploadMegaFile(uploadPlan);
      this.addMessage("system", `Copied file to ${result.targetPath}`, "system");
    } catch {
      this.addMessage("system", cancelMessage, "system");
    }
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
    const selector = new ModelSelector(
      this.config.providers,
      this.state.provider,
      this.state.model,
      (providerId, modelId) => {
        const provider = getProvider(this.config, providerId);
        const model = getModel(provider, modelId);
        this.closeModelSelector();
        this.setModel(providerId, modelId);
        this.showPrompt(`Model set to ${provider.name} / ${model.name}`);
        this.requestRender();
      },
      () => {
        this.closeModelSelector();
        this.requestRender();
      },
      initialSearch,
    );
    this.modelSelector = selector;
    this.armSelectorConfirmSuppression();
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
    this.armSelectorConfirmSuppression();
    this.refreshChat();
    this.tui.setFocus(selector);
  }

  private closeRankSelector(): void {
    this.rankSelector = undefined;
    this.tui.setFocus(this.editor);
  }

  private showResourceMatchSelector(mode: "mega" | "asmrone"): void {
    const selector = new ResourceMatchSelector(
      (selection) => {
        this.closeResourceMatchSelector();
        void this.handleResourceMatchSelection(mode, selection);
      },
      () => {
        this.closeResourceMatchSelector();
        this.requestRender();
      },
    );
    this.resourceMatchMode = mode;
    this.resourceMatchSelector = selector;
    this.armSelectorConfirmSuppression();
    this.refreshChat();
    this.tui.setFocus(selector);
  }

  private closeResourceMatchSelector(): void {
    this.resourceMatchSelector = undefined;
    this.resourceMatchMode = undefined;
    this.tui.setFocus(this.editor);
  }

  private async handleResourceMatchSelection(
    mode: "mega" | "asmrone",
    selection: ResourceMatchSelection,
  ): Promise<void> {
    await handleResourceMatchSelectionAction(mode, selection, async (submission) => {
      await this.submitChat(submission);
    });
  }

  private async handleRankSelection(selection: RankSelection): Promise<void> {
    const state = await handleRankSelectionAction(selection, {
      rankPageServer: this.rankPageServer,
      openUrlCommand: this.openUrlCommand,
      detectOpenUrlCommand: () => this.detectOpenUrlCommand(),
      submitChat: async (submission) => {
        await this.submitChat(submission);
      },
    });
    if (state.rankPageServer) this.rankPageServer = state.rankPageServer;
    if (state.openUrlCommand) this.openUrlCommand = state.openUrlCommand;
  }

  private async openRankPage(selection: RankSelection): Promise<void> {
    const state = await handleRankSelectionAction({ ...selection, openPage: true }, {
      rankPageServer: this.rankPageServer,
      openUrlCommand: this.openUrlCommand,
      detectOpenUrlCommand: () => this.detectOpenUrlCommand(),
      submitChat: async (submission) => {
        await this.submitChat(submission);
      },
    });
    if (state.rankPageServer) this.rankPageServer = state.rankPageServer;
    if (state.openUrlCommand) this.openUrlCommand = state.openUrlCommand;
  }

  private showCircleSelector(): void {
    const { items, error } = loadCircleSelectorItems();
    if (error) {
      this.showPrompt(error);
    }

    const selector = new CircleSelector(
      (selection) => {
        this.closeCircleSelector();
        void this.handleCircleSelection(selection);
      },
      () => {
        this.closeCircleSelector();
        this.requestRender();
      },
      items,
    );
    this.circleSelector = selector;
    this.armSelectorConfirmSuppression();
    this.refreshChat();
    this.tui.setFocus(selector);
  }

  private closeCircleSelector(): void {
    this.circleSelector = undefined;
    this.tui.setFocus(this.editor);
  }

  private async handleCircleSelection(selection: CircleSelection): Promise<void> {
    const state = await handleCircleSelectionAction(selection, {
      rankPageServer: this.rankPageServer,
      openUrlCommand: this.openUrlCommand,
      detectOpenUrlCommand: () => this.detectOpenUrlCommand(),
      submitChat: async (submission) => {
        await this.submitChat(submission);
      },
      addMessage: (kind, text, label) => {
        this.addMessage(kind, text, label);
      },
      requestRender: () => this.requestRender(),
    });
    if (state.rankPageServer) this.rankPageServer = state.rankPageServer;
    if (state.openUrlCommand) this.openUrlCommand = state.openUrlCommand;
  }

  private async openCirclePage(): Promise<void> {
    const state = await handleCircleSelectionAction({ outputMode: "page" }, {
      rankPageServer: this.rankPageServer,
      openUrlCommand: this.openUrlCommand,
      detectOpenUrlCommand: () => this.detectOpenUrlCommand(),
      submitChat: async (submission) => {
        await this.submitChat(submission);
      },
      addMessage: (kind, text, label) => {
        this.addMessage(kind, text, label);
      },
      requestRender: () => this.requestRender(),
    });
    if (state.rankPageServer) this.rankPageServer = state.rankPageServer;
    if (state.openUrlCommand) this.openUrlCommand = state.openUrlCommand;
  }

  private showWorksSelector(): void {
    const { items, error } = loadWorksSelectorItems();
    if (error) {
      this.showPrompt(error);
    }

    const selector = new WorksSelector(
      (selection) => {
        this.closeWorksSelector();
        void this.handleWorksSelection(selection);
      },
      () => {
        this.closeWorksSelector();
        this.requestRender();
      },
      items,
    );
    this.worksSelector = selector;
    this.armSelectorConfirmSuppression();
    this.refreshChat();
    this.tui.setFocus(selector);
  }

  private closeWorksSelector(): void {
    this.worksSelector = undefined;
    this.tui.setFocus(this.editor);
  }

  private async handleWorksSelection(selection: WorksSelection): Promise<void> {
    const state = await handleWorksSelectionAction(selection, {
      rankPageServer: this.rankPageServer,
      openUrlCommand: this.openUrlCommand,
      detectOpenUrlCommand: () => this.detectOpenUrlCommand(),
      submitChat: async (submission) => {
        await this.submitChat(submission);
      },
    });
    if (state.rankPageServer) this.rankPageServer = state.rankPageServer;
    if (state.openUrlCommand) this.openUrlCommand = state.openUrlCommand;
  }

  private async openWorksPage(selection: WorksSelection): Promise<void> {
    const state = await handleWorksSelectionAction({ ...selection, outputMode: "page" }, {
      rankPageServer: this.rankPageServer,
      openUrlCommand: this.openUrlCommand,
      detectOpenUrlCommand: () => this.detectOpenUrlCommand(),
      submitChat: async (submission) => {
        await this.submitChat(submission);
      },
    });
    if (state.rankPageServer) this.rankPageServer = state.rankPageServer;
    if (state.openUrlCommand) this.openUrlCommand = state.openUrlCommand;
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
    this.armSelectorConfirmSuppression();
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
    const provider = getProvider(this.config, this.state.provider);
    const model = getModel(provider, this.state.model);
    return runExploreSubagentWithSnapshot({
      agent,
      task,
      toolEntry,
      snapshots: this.subagentSnapshots,
      reuseMode: options.reuseMode,
      subagentId: options.subagentId,
      provider,
      modelId: model.id,
      cwd: this.state.cwd,
      activeAbortSignal: this.activeAIAbort?.signal,
      requestRender: () => this.requestRender(),
    });
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
    const state = hydrateSessionState(session);
    this.messages = state.messages;
    this.sessionMessages = state.sessionMessages;
    this.subagentSnapshots = state.subagentSnapshots;
    this.openSubagentId = undefined;
    this.subagentSelector = undefined;
    this.currentSessionId = state.currentSessionId;
    this.currentSessionTitle = state.currentSessionTitle;
    this.state.messageCount = state.messageCount;
    this.updateContextUsage();
  }

  private persistSession(): void {
    if (this.sessionMessages.length === 0) return;
    saveSession(...createSessionSaveArgs(
      this.currentSessionId,
      this.sessionMessages,
      this.messages,
      this.state.startedAt,
      this.currentSessionTitle,
      this.subagentSnapshots,
    ));
  }

  private setModel(providerId: string, modelId: string): void {
    const provider = getProvider(this.config, providerId);
    const model = getModel(provider, modelId);
    this.config = saveDefaultModel(this.config, provider.id, model.id);
    this.state.provider = provider.id;
    this.state.providerName = provider.name;
    this.state.model = model.id;
    this.state.contextDisplay = formatContextWindow(model.contextWindow);
    this.state.contextWindow = model.contextWindow;
    this.state.outputLimit = model.outputLimit;
    this.state.availableModels = provider.models.map((item) => item.id);
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
    } else if (this.resourceMatchSelector) {
      this.chat.addChild(this.resourceMatchSelector);
    } else if (this.circleSelector) {
      this.chat.addChild(this.circleSelector);
    } else if (this.worksSelector) {
      this.chat.addChild(this.worksSelector);
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
