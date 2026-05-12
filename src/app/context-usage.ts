import type { ChatHistoryMessage } from "../core/ai.ts";
import { buildSystemPrompt } from "../prompts/system.ts";

export const buildChatHistory = (cwd: string, sessionMessages: ChatHistoryMessage[]): ChatHistoryMessage[] => [
  buildSystemPrompt(cwd),
  ...sessionMessages,
];

export const estimateMessageTokens = (message: ChatHistoryMessage): number => {
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
};

export const estimateContextTokens = (messages: ChatHistoryMessage[]): number =>
  messages.reduce((total, message) => total + estimateMessageTokens(message), 0);

export const calculateContextUsage = (
  tokens: number,
  contextWindow: number,
): { contextTokens: number; contextPercent: string } => {
  const percent = contextWindow > 0 ? (tokens / contextWindow) * 100 : 0;
  return { contextTokens: tokens, contextPercent: percent.toFixed(1) };
};
