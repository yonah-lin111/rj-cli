import type { Component, DefaultTextStyle } from "@mariozechner/pi-tui";
import { Markdown, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { markdownTheme, theme } from "../theme.js";

export type MessageKind = "user" | "assistant" | "system" | "command" | "error" | "warning";

export interface Message {
  kind: MessageKind;
  text: string;
  label?: string;
  thinking?: string;
  strikethrough?: boolean;
}

const colors: Record<MessageKind, (text: string) => string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.system,
  command: theme.bashMode,
  error: theme.error,
  warning: theme.warning,
};

const textStyles: Record<MessageKind, DefaultTextStyle> = {
  user: {},
  assistant: {},
  system: {},
  command: { color: theme.bashMode },
  error: { color: theme.error },
  warning: { color: theme.warning },
};

function messageHeader(message: Message): string {
  const label = message.label ?? message.kind;
  return `${colors[message.kind](label + ":")}`;

}

function renderMarkdown(text: string, width: number, style: DefaultTextStyle): string[] {
  return new Markdown(text.trimEnd(), 0, 0, markdownTheme, style).render(width);
}

function applyMessageStyle(lines: string[], message: Message): string[] {
  if (!message.strikethrough) return lines;
  return lines.map((line) => theme.dim(theme.strikethrough(line)));
}

export function formatMessage(message: Message, width = 80): string[] {
  const header = messageHeader(message);
  const contentWidth = Math.max(20, width - 2);

  if (message.kind !== "assistant") {
    return applyMessageStyle([header, ...renderMarkdown(message.text, contentWidth, textStyles[message.kind])], message);
  }

  const lines = [header];
  if (message.thinking?.trim()) {
    lines.push(`${theme.thinkingLabel("thinking：")}`);
    lines.push(...renderMarkdown(message.thinking.trimEnd(), contentWidth, { color: theme.thinkingText, italic: true }));
    if (message.text.trim()) lines.push("");
  }
  if (message.text.trim()) lines.push(...renderMarkdown(message.text.trimEnd(), contentWidth, textStyles.assistant));
  return applyMessageStyle(lines, message);
}

export class MessagesView implements Component {
  constructor(private getMessages: () => Message[], private maxRendered = 120) {}

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
        for (const line of wrapped) lines.push(` ${truncateToWidth(line, width - 1, "...")}`);
      }
      lines.push("");
    }
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  }
}
