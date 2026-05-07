import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export type MessageKind = "user" | "assistant" | "system" | "command" | "error" | "warning";

export interface Message {
  kind: MessageKind;
  text: string;
  label?: string;
}

const colors: Record<MessageKind, (text: string) => string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.system,
  command: theme.bashMode,
  error: theme.error,
  warning: theme.warning,
};

export function formatMessage(message: Message): string {
  const label = message.label ?? message.kind;
  return `${colors[message.kind](label)} ${theme.dim("│")} ${message.text}`;
}

export class MessagesView implements Component {
  constructor(private getMessages: () => Message[], private maxRendered = 120) {}

  invalidate(): void {}

  render(width: number): string[] {
    const messages = this.getMessages().slice(-this.maxRendered);
    if (messages.length === 0) {
      return [theme.dim("  Ask RJ anything, type /help for commands, or !pwd to run shell commands.")];
    }

    const lines: string[] = [];
    for (const message of messages) {
      const contentWidth = Math.max(20, width - 2);
      const wrapped = wrapTextWithAnsi(formatMessage(message), contentWidth);
      for (const line of wrapped) lines.push(` ${truncateToWidth(line, width - 1, "...")}`);
      lines.push("");
    }
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  }
}
