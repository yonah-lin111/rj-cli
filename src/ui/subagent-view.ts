import {
  Container, Spacer, Text,
  type Component, type Focusable,
} from "@mariozechner/pi-tui";
import { theme } from "./theme.ts";
import type { RJSubagentConfig } from "../core/config.ts";
import type { SubagentToolEntry } from "../subagent/runner.ts";
import { MessagesView, type Message } from "./messages.ts";

/** 动态宽度分隔线组件 */
class DividerLine implements Component {
  invalidate(): void {}
  render(width: number): string[] {
    return [theme.muted("─".repeat(Math.max(20, width - 2)))];
  }
}

/** subagent 执行快照，用于重新打开时展示历史 */
export interface SubagentSnapshot {
  agentId: string;
  agentName: string;
  taskDescription: string;
  /** AI 生成的简短 title，完成后更新 */
  title: string;
  fullOutput: string;
  toolEntries: SubagentToolEntry[];
  status: "running" | "done" | "error";
  errorMessage?: string;
  /** 用于 MessagesView 渲染的消息列表 */
  messages: Message[];
}

/**
 * SubagentView — 全屏展示 subagent 执行详情。
 * 复用 MessagesView，user 标签显示为 main，assistant 标签显示为 subagent。
 * 按 Esc 关闭。
 */
export class SubagentView extends Container implements Focusable {
  private headerText: Text;
  private hintText: Text;
  private messagesView: MessagesView;
  private spinnerTimer?: NodeJS.Timeout;
  private spinnerFrame = 0;

  private static readonly SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  focused = false;

  constructor(
    private snapshot: SubagentSnapshot,
    private onClose: () => void,
  ) {
    super();

    this.headerText = new Text("", 1, 0);
    this.hintText = new Text(theme.dim("esc  close"), 1, 0);
    this.messagesView = new MessagesView(() => this.snapshot.messages);

    this.syncHeaderText();
    this.rebuild();

    if (this.snapshot.status === "running") {
      this.spinnerTimer = setInterval(() => {
        this.spinnerFrame = (this.spinnerFrame + 1) % SubagentView.SPINNER_FRAMES.length;
        this.syncHeaderText();
        super.invalidate();
      }, 80);
    }
  }

  handleInput(keyData: string): void {
    if (keyData === "\x1b") {
      this.onClose();
    }
  }

  invalidate(): void {
    super.invalidate();
  }

  /** 标记执行完成，更新 title */
  markDone(title?: string): void {
    this.stopSpinner();
    this.snapshot.status = "done";
    if (title) this.snapshot.title = title;
    this.syncHeaderText();
  }

  /** 标记执行出错 */
  markError(message: string): void {
    this.stopSpinner();
    this.snapshot.status = "error";
    this.snapshot.errorMessage = message;
    this.snapshot.messages.push({ kind: "error", text: message, label: "error" });
    this.syncHeaderText();
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
    }
  }

  private syncHeaderText(): void {
    const statusIcon =
      this.snapshot.status === "running"
        ? theme.accent(SubagentView.SPINNER_FRAMES[this.spinnerFrame]!)
        : this.snapshot.status === "error"
          ? theme.error("✗")
          : theme.success("✓");
    const title = this.snapshot.title || this.snapshot.taskDescription;
    this.headerText.setText(
      `${statusIcon} ${theme.bold(this.snapshot.agentName)} ${theme.dim("— " + title)}`,
    );
  }

  private rebuild(): void {
    this.clear();
    this.addChild(new DividerLine());
    this.addChild(this.headerText);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(this.messagesView);
    this.addChild(new DividerLine());
  }
}

/**
 * 从 RJSubagentConfig 和任务描述创建初始快照。
 */
export const createSubagentSnapshot = (
  agent: RJSubagentConfig,
  taskDescription: string,
): SubagentSnapshot => ({
  agentId: agent.id,
  agentName: agent.name,
  taskDescription,
  title: "",
  fullOutput: "",
  toolEntries: [],
  status: "running",
  messages: [{ kind: "user", text: taskDescription, label: "main" }],
});
