import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export type MessageKind = "user" | "assistant" | "system" | "command" | "error" | "warning";

export interface Message {
  kind: MessageKind;
  text: string;
  label?: string;
  thinking?: string;
}

const colors: Record<MessageKind, (text: string) => string> = {
  user: theme.user,
  assistant: theme.assistant,
  system: theme.system,
  command: theme.bashMode,
  error: theme.error,
  warning: theme.warning,
};

function messageHeader(message: Message): string {
  const label = message.label ?? message.kind;
  return `${colors[message.kind](label)} ${theme.dim("│")}`;
}

export function formatMessage(message: Message): string {
  const header = messageHeader(message);
  if (message.kind !== "assistant") return `${header} ${message.text}`;

  const parts = [header];
  if (message.thinking?.trim()) {
    parts.push(`${theme.thinkingLabel("thinking：")}\n${theme.thinkingText(message.thinking.trimEnd())}`);
  }
  if (message.text.trim()) parts.push(theme.assistant(message.text.trimEnd()));
  return parts.join("\n");
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
      for (const part of formatMessage(message).split("\n")) {
        const wrapped = wrapTextWithAnsi(part, contentWidth);
        for (const line of wrapped) lines.push(` ${truncateToWidth(line, width - 1, "...")}`);
      }
      lines.push("");
    }
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  }
}
