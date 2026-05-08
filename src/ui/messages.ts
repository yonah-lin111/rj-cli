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

/** 单条聊天消息 */
export interface Message {
  kind: MessageKind;
  text: string;
  /** 展开 @mention 后的完整文本，用于发送给 AI */
  expandedText?: string;
  label?: string;
  thinking?: string;
  strikethrough?: boolean;
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

/**
 * 对消息行应用删除线样式（用于已取消的对话）。
 */
const applyMessageStyle = (lines: string[], message: Message): string[] => {
  if (!message.strikethrough) return lines;
  return lines.map((line) => theme.dim(theme.strikethrough(line)));
};

/**
 * 将消息格式化为终端渲染行数组。
 * assistant 消息额外支持思考内容展示。
 */
export const formatMessage = (message: Message, width = 80): string[] => {
  const header = messageHeader(message);
  const contentWidth = Math.max(20, width - 2);

  if (message.kind !== "assistant") {
    return applyMessageStyle(
      [
        header,
        ...renderMarkdown(message.text, contentWidth, textStyles[message.kind]),
      ],
      message,
    );
  }

  const lines = [header];
  if (message.thinking?.trim()) {
    lines.push(`${theme.thinkingLabel("thinking")}`);
    lines.push(
      ...renderMarkdown(message.thinking.trimEnd(), contentWidth, {
        color: theme.thinkingText,
        italic: true,
      }),
    );
    if (message.text.trim()) lines.push("");
  }
  if (message.text.trim())
    lines.push(
      ...renderMarkdown(
        message.text.trimEnd(),
        contentWidth,
        textStyles.assistant,
      ),
    );
  return applyMessageStyle(lines, message);
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
