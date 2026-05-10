import type { Component, DefaultTextStyle } from "@mariozechner/pi-tui";
import {
  Markdown,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { markdownTheme, theme } from "./theme.ts";

/** 消息类型 */
export type MessageKind =
  | "user"
  | "assistant"
  | "system"
  | "command"
  | "error"
  | "warning";

/** tool call 状态 */
export type ToolCallStatus = "running" | "completed" | "error";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** assistant 消息内的单条 tool call */
export interface ToolCallEntry {
  id: string;
  name: string;
  status: ToolCallStatus;
  /** 调用行，如 "Read Desktop/hello.txt" */
  callLabel: string;
  /** 结果行，如 "Patched Desktop/hello.txt" */
  resultLabel?: string;
  /** 工具返回内容摘要来源 */
  resultText?: string;
  /** 工具结果是否为错误 */
  isError?: boolean;
  /** 工具结果的自定义展示内容 */
  displayText?: string;
  /** 当前 spinner 帧索引（running 时使用） */
  spinnerFrame?: number;
  /** explore subagent 关联的快照 id，用于 ctrl+o */
  subagentId?: string;
}

/** assistant 消息的一个轮次段落：thinking + text + tool calls */
export interface AssistantSegment {
  thinking?: string;
  text: string;
  toolCalls?: ToolCallEntry[];
}

/** 单条聊天消息 */
export interface Message {
  kind: MessageKind;
  text: string;
  /** 展开 @mention 后的完整文本，用于发送给 AI */
  expandedText?: string;
  label?: string;
  thinking?: string;
  strikethrough?: boolean;
  compact?: boolean;
  /** assistant 消息的多轮段落（有此字段时忽略 text/thinking） */
  segments?: AssistantSegment[];
}

/** 各消息类型对应的颜色函数 */
const colors: Record<MessageKind, (text: string) => string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.system,
  command: theme.bashMode,
  error: theme.error,
  warning: theme.warning,
};

/** 各消息类型对应的默认文本样式 */
const textStyles: Record<MessageKind, DefaultTextStyle> = {
  user: {},
  assistant: {},
  system: {},
  command: { color: theme.bashMode },
  error: { color: theme.error },
  warning: { color: theme.warning },
};

/**
 * 生成消息头部标签行。
 */
const messageHeader = (message: Message): string => {
  const label = message.label ?? message.kind;
  return `${colors[message.kind](label + ":")}`;
};

/**
 * 将文本渲染为带样式的 Markdown 行数组。
 */
const renderMarkdown = (
  text: string,
  width: number,
  style: DefaultTextStyle,
): string[] =>
  new Markdown(text.trimEnd(), 0, 0, markdownTheme, style).render(width);

/** 渲染单条 tool call 的调用行 */
const renderToolCall = (entry: ToolCallEntry): string[] => {
  // explore subagent 特殊渲染格式
  if (entry.name === "explore") {
    const statusIcon =
      entry.status === "running"
        ? theme.accent(SPINNER_FRAMES[(entry.spinnerFrame ?? 0) % SPINNER_FRAMES.length]!)
        : entry.status === "error"
          ? theme.error("✗")
          : theme.success("✓");
    const nameLine = `${theme.accent("/explore")} ${statusIcon}`;
    const taskLine = ` ${theme.dim("⎿")}  ${theme.dim(entry.callLabel)}`;
    const hintLine = ` ${theme.muted("ctrl+o")}`;
    return [nameLine, taskLine, hintLine];
  }

  let indicator: string;
  if (entry.name === "ask") {
    if (entry.status === "running") {
      indicator = theme.askIndicator("Q");
    } else if (entry.status === "completed") {
      indicator = theme.askIndicator("Q");
    } else {
      indicator = theme.error("Q");
    }
  } else if (entry.name === "read_file") {
    indicator = entry.status === "error" ? theme.error("→") : theme.fileArrow("→");
  } else if (entry.name === "write_file" || entry.name === "edit_file") {
    indicator = entry.status === "error" ? theme.error("←") : theme.fileArrow("←");
  } else if (entry.name === "bash") {
    indicator = theme.success("*");
  } else if (entry.status === "running") {
    indicator = theme.dim("·");
  } else if (entry.status === "completed") {
    indicator = theme.dim("·");
  } else {
    indicator = theme.error("✗");
  }
  const label =
    entry.name === "ask"
      ? (entry.status === "error" ? theme.error(entry.callLabel) : theme.askLabel(entry.callLabel))
      : (entry.status === "error" ? theme.error(entry.callLabel) : theme.dim(entry.callLabel));
  const resultLabel =
    entry.status !== "running" && entry.resultLabel
      ? ` ${theme.dim("—")} ${entry.status === "error" ? theme.error(entry.resultLabel) : theme.dim(entry.resultLabel)}`
      : "";
  const lines = [`${indicator} ${label}${resultLabel}`];
  return lines;
};

const renderThinking = (thinking: string, width: number): string[] =>
  renderMarkdown(thinking.trim(), width, { color: theme.thinkingText });

const renderTodoList = (entry: ToolCallEntry, width: number): string[] => {
  if (!entry.displayText) return [];
  const frame = SPINNER_FRAMES[(entry.spinnerFrame ?? 0) % SPINNER_FRAMES.length];
  return entry.displayText.split("\n").map((line, index) => {
    if (index === 0) return theme.todoTitle(line.replace(/^#\s*/, ""));
    return theme.todoText(line).replace("[loading]", ` ${theme.accent(frame!)} `);
  });
};

const latestTodoEntry = (segments: AssistantSegment[]): ToolCallEntry | undefined => {
  for (let i = segments.length - 1; i >= 0; i--) {
    const toolCalls = segments[i]?.toolCalls;
    if (!toolCalls?.length) continue;
    for (let j = toolCalls.length - 1; j >= 0; j--) {
      const entry = toolCalls[j];
      if (entry?.name === "todowrite" && entry.displayText) return entry;
    }
  }
  return undefined;
};

const todoStatusTextPattern = /^(让我|我来|现在)?(来)?(创建|更新|调整|标记|记录)(一个|一下)?\s*(任务|todo|Todo|待办)(列表)?(来)?(确认这个情况|确认|记录|更新)?(状态)?[：:]?$/;

const filterTodoStatusLines = (text: string, hasTodoWrite: boolean): string => {
  if (!hasTodoWrite) return text;
  return text
    .split("\n")
    .filter((line) => !todoStatusTextPattern.test(line.trim()))
    .join("\n")
    .trim();
};

/** 渲染 assistant 消息的一个段落 */
const renderSegment = (
  seg: AssistantSegment,
  contentWidth: number,
): string[] => {
  const lines: string[] = [];
  const hasTodoWrite = seg.toolCalls?.some((entry) => entry.name === "todowrite") ?? false;
  const text = filterTodoStatusLines(seg.text, hasTodoWrite);
  if (seg.thinking?.trim()) {
    lines.push(...renderThinking(seg.thinking, contentWidth));
    if (text.trim() || seg.toolCalls?.length) lines.push("");
  }
  if (text.trim()) {
    lines.push(...renderMarkdown(text.trimEnd(), contentWidth, {}));
  }
  if (seg.toolCalls?.length) {
    if (text.trim()) lines.push("");
    for (const entry of seg.toolCalls) {
      if (entry.name === "todowrite") continue;
      lines.push(...renderToolCall(entry));
      if (entry.name === "ask" && entry.displayText && entry.status === "completed") {
        for (const line of entry.displayText.split("\n")) {
          lines.push(theme.dim(`  ${line}`));
        }
      }
    }
  }
  return lines;
};

/**
 * 对消息行应用删除线样式（用于已取消的对话）。
 */
const applyMessageStyle = (lines: string[], message: Message): string[] => {
  if (!message.strikethrough) return lines;
  return lines.map((line) => theme.dim(theme.strikethrough(line)));
};

const limitLines = (lines: string[], maxLines: number): string[] => {
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]}...`];
};

/**
 * 将消息格式化为终端渲染行数组。
 * assistant 消息额外支持思考内容展示。
 */
export const formatMessage = (message: Message, width = 80): string[] => {
  const header = messageHeader(message);
  const contentWidth = Math.max(20, width - 2);

  if (message.kind !== "assistant") {
    const lines = [
      header,
      ...renderMarkdown(message.text, contentWidth, textStyles[message.kind]),
    ];
    return applyMessageStyle(
      message.compact ? limitLines(lines, 3) : lines,
      message,
    );
  }

  const lines = [header];
  if (message.segments?.length) {
    for (let i = 0; i < message.segments.length; i++) {
      const segLines = renderSegment(message.segments[i], contentWidth);
      if (segLines.length) {
        if (i > 0) lines.push("");
        lines.push(...segLines);
      }
    }
    const todoEntry = latestTodoEntry(message.segments);
    if (todoEntry?.displayText) {
      if (lines.length > 1) lines.push("");
      lines.push(...renderTodoList(todoEntry, contentWidth));
    }
  } else {
    // 兼容无 segments 的旧格式
    if (message.thinking?.trim()) {
      lines.push(...renderThinking(message.thinking, contentWidth));
      if (message.text.trim()) lines.push("");
    }
    if (message.text.trim())
      lines.push(...renderMarkdown(message.text.trimEnd(), contentWidth, {}));
  }
  return applyMessageStyle(message.compact ? limitLines(lines, 3) : lines, message);
};

/** 消息列表视图组件，最多渲染最近 maxRendered 条消息 */
export class MessagesView implements Component {
  constructor(
    private getMessages: () => Message[],
    private maxRendered = 120,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const messages = this.getMessages().slice(-this.maxRendered);
    if (messages.length === 0) {
      return [theme.dim("  Ask RJ anything or type /help for commands.")];
    }

    const lines: string[] = [];
    for (const message of messages) {
      if (message.kind === "user" && lines.length > 0) {
        if (lines[lines.length - 1] !== "") lines.push("");
        lines.push(theme.muted("─".repeat(Math.max(20, width - 2))));
        lines.push("");
      }

      for (const part of formatMessage(message, width)) {
        const wrapped = wrapTextWithAnsi(part, Math.max(20, width - 2));
        for (const line of wrapped)
          lines.push(` ${truncateToWidth(line, width - 1, "...")}`);
      }
      lines.push("");
    }
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  }
}
