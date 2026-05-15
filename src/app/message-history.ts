import type { ChatHistoryMessage } from "../core/ai.ts";
import type { Message } from "../ui/messages.ts";

const findLastIndex = <T>(items: T[], predicate: (item: T) => boolean, fromIndex = items.length - 1): number => {
  for (let i = fromIndex; i >= 0; i--) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
};

export const findLastQAPair = (messages: Message[]): { assistantIndex: number; userIndex: number } | undefined => {
  const assistantIndex = findLastIndex(messages, (message) => message.kind === "assistant");
  if (assistantIndex <= 0) return undefined;
  const userIndex = findLastIndex(messages, (message) => message.kind === "user", assistantIndex - 1);
  if (userIndex < 0) return undefined;
  return { assistantIndex, userIndex };
};

export const trimLastSessionQA = (sessionMessages: ChatHistoryMessage[]): void => {
  const assistantIndex = findLastIndex(sessionMessages, (message) => message.role === "assistant");
  if (assistantIndex < 0) return;
  const userIndex = findLastIndex(sessionMessages, (message) => message.role === "user", assistantIndex - 1);
  if (userIndex < 0) return;
  sessionMessages.splice(userIndex);
};
