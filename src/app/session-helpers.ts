import type { ChatHistoryMessage } from "../core/ai.ts";
import type { SessionRecord } from "../core/session.ts";
import type { Message } from "../ui/messages.ts";
import type { SubagentSnapshot } from "../ui/subagent-view.ts";

export const hydrateSessionState = (
  session: SessionRecord,
): {
  messages: Message[];
  sessionMessages: ChatHistoryMessage[];
  subagentSnapshots: Map<string, SubagentSnapshot>;
  currentSessionId: string;
  currentSessionTitle: string;
  messageCount: number;
} => {
  const messages = session.uiMessages;
  return {
    messages,
    sessionMessages: session.sessionMessages,
    subagentSnapshots: new Map((session.subagentSnapshots ?? []).map((snapshot) => [snapshot.id, snapshot])),
    currentSessionId: session.id,
    currentSessionTitle: session.title,
    messageCount: messages.filter((message) => message.kind === "user" || message.kind === "assistant").length,
  };
};

export const createSessionSaveArgs = (
  currentSessionId: string,
  sessionMessages: ChatHistoryMessage[],
  messages: Message[],
  startedAt: Date,
  currentSessionTitle: string | undefined,
  subagentSnapshots: Map<string, SubagentSnapshot>,
): [string, ChatHistoryMessage[], Message[], Date, string | undefined, SubagentSnapshot[]] => [
  currentSessionId,
  sessionMessages,
  messages,
  startedAt,
  currentSessionTitle,
  Array.from(subagentSnapshots.values()),
];
