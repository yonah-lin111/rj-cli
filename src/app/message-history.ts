import type { ChatHistoryMessage } from "../core/ai.ts";
import type { Message } from "../ui/messages.ts";

const findLastIndex = <T>(items: T[], predicate: (item: T) => boolean, fromIndex = items.length - 1): number => {
  for (let i = fromIndex; i >= 0; i--) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
};

const rjCodePattern = /RJ\d+/gi;
const rjDetailToolNames = new Set(["rj_get_detail", "rj_query"]);
const resourceMatchToolNames = new Set(["match_mega_resources", "match_asmrone_resources"]);

/** 上一轮问答的边界 */
export interface LastQARange {
  userIndex: number;
  assistantIndex: number;
}

/** 脱敏后的 RJ 信息 */
export interface LastQARjInfoItem {
  rj_code: string;
  title?: string;
  circle?: string;
  cv?: string;
  tags?: string[];
  source?: string;
  status?: number;
  release_date?: string;
  is_all_ages?: boolean;
}

/** 上一轮问答中的 RJ 信息提取结果 */
export interface LastQARjInfoSummary {
  range?: LastQARange;
  items: LastQARjInfoItem[];
  textOnlyCodes: string[];
  matchedSources: Array<{ rj_code: string; source?: string; status?: string }>;
}

const normalizeRjCode = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = value.toUpperCase().match(/RJ\d+/);
  return match?.[0];
};

const parseJsonObject = (content: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
};

const collectRjCodesFromText = (text: string): string[] => {
  const matches = text.match(rjCodePattern) ?? [];
  return matches.map((match) => match.toUpperCase());
};

const extractAssistantText = (message: Extract<ChatHistoryMessage, { role: "assistant" }>): string => {
  if (message.blocks?.length) {
    return message.blocks
      .filter((block): block is Extract<NonNullable<typeof message.blocks>[number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
  return message.content ?? "";
};

const pickRjInfoFields = (raw: Record<string, unknown>): LastQARjInfoItem | undefined => {
  const rjCode = normalizeRjCode(raw.rj_code);
  if (!rjCode) return undefined;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((item): item is string => typeof item === "string") : undefined;
  return {
    rj_code: rjCode,
    title: typeof raw.title === "string" ? raw.title : undefined,
    circle: typeof raw.circle === "string" ? raw.circle : undefined,
    cv: typeof raw.cv === "string" ? raw.cv : undefined,
    tags: tags && tags.length > 0 ? tags : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
    status: typeof raw.status === "number" ? raw.status : undefined,
    release_date: typeof raw.release_date === "string" ? raw.release_date : undefined,
    is_all_ages: typeof raw.is_all_ages === "boolean" ? raw.is_all_ages : undefined,
  };
};

const collectRjInfoFromToolPayload = (toolName: string | undefined, payload: Record<string, unknown>): LastQARjInfoItem[] => {
  if (!toolName || !rjDetailToolNames.has(toolName)) return [];
  if (toolName === "rj_get_detail") {
    const item = pickRjInfoFields(payload);
    return item ? [item] : [];
  }
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((item) => (item && typeof item === "object" ? pickRjInfoFields(item as Record<string, unknown>) : undefined))
    .filter((item): item is LastQARjInfoItem => Boolean(item));
};

type MatchedSourceInfo = { rj_code: string; source?: string; status?: string };

const collectMatchedSourcesFromToolPayload = (
  toolName: string | undefined,
  payload: Record<string, unknown>,
): MatchedSourceInfo[] => {
  if (!toolName || !resourceMatchToolNames.has(toolName)) return [];
  const items = Array.isArray(payload.items) ? payload.items : [];
  const results: MatchedSourceInfo[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const rjCode = normalizeRjCode(record.rj_code);
    if (!rjCode) continue;
    results.push({
      rj_code: rjCode,
      source: typeof record.source === "string" ? record.source : undefined,
      status: typeof record.exists === "boolean" ? (record.exists ? "matched" : undefined) : undefined,
    });
  }
  return results;
};

export const findLastQAPair = (messages: Message[]): { assistantIndex: number; userIndex: number } | undefined => {
  const assistantIndex = findLastIndex(messages, (message) => message.kind === "assistant");
  if (assistantIndex <= 0) return undefined;
  const userIndex = findLastIndex(
    messages,
    (message) => message.kind === "user" || message.kind === "command",
    assistantIndex - 1,
  );
  if (userIndex < 0) return undefined;
  return { assistantIndex, userIndex };
};

export const findLastSessionQARange = (sessionMessages: ChatHistoryMessage[]): LastQARange | undefined => {
  const assistantIndex = findLastIndex(sessionMessages, (message) => message.role === "assistant");
  if (assistantIndex <= 0) return undefined;
  const userIndex = findLastIndex(sessionMessages, (message) => message.role === "user", assistantIndex - 1);
  if (userIndex < 0) return undefined;
  return { userIndex, assistantIndex };
};

export const trimLastSessionQA = (sessionMessages: ChatHistoryMessage[]): void => {
  const range = findLastSessionQARange(sessionMessages);
  if (!range) return;
  sessionMessages.splice(range.userIndex);
};

export const extractLastQARjInfo = (sessionMessages: ChatHistoryMessage[]): LastQARjInfoSummary => {
  const range = findLastSessionQARange(sessionMessages);
  if (!range) {
    return { items: [], textOnlyCodes: [], matchedSources: [] };
  }

  const codesFromText = new Set<string>();
  const itemMap = new Map<string, LastQARjInfoItem>();
  const matchedSourceMap = new Map<string, { rj_code: string; source?: string; status?: string }>();

  for (let index = range.userIndex; index <= range.assistantIndex; index++) {
    const message = sessionMessages[index];
    if (!message) continue;

    if (message.role === "user") {
      for (const code of collectRjCodesFromText(message.content)) codesFromText.add(code);
      continue;
    }

    if (message.role === "assistant") {
      for (const code of collectRjCodesFromText(extractAssistantText(message))) codesFromText.add(code);
      continue;
    }

    if (message.role === "tool") {
      if (message.isError) continue;
      const payload = parseJsonObject(message.content);
      if (!payload) continue;

      for (const item of collectRjInfoFromToolPayload(message.toolName, payload)) {
        itemMap.set(item.rj_code, { ...itemMap.get(item.rj_code), ...item });
      }
      for (const item of collectMatchedSourcesFromToolPayload(message.toolName, payload)) {
        matchedSourceMap.set(item.rj_code, { ...matchedSourceMap.get(item.rj_code), ...item });
      }
    }
  }

  const textOnlyCodes = [...codesFromText].filter((code) => !itemMap.has(code)).sort();
  const items = [...itemMap.values()].sort((a, b) => a.rj_code.localeCompare(b.rj_code));
  const matchedSources = [...matchedSourceMap.values()]
    .filter((item) => item.status === "matched" && (!itemMap.has(item.rj_code) || item.source))
    .sort((a, b) => a.rj_code.localeCompare(b.rj_code));

  return { range, items, textOnlyCodes, matchedSources };
};
