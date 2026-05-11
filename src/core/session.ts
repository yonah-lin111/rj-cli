import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import type { ChatHistoryMessage } from "./ai.ts";
import type { RJProviderConfig } from "./config.ts";
import type { Message } from "../ui/messages.ts";
import type { SubagentSnapshot } from "../ui/subagent-view.ts";

/** 单个会话的持久化结构 */
export interface SessionRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sessionMessages: ChatHistoryMessage[];
  uiMessages: Message[];
  subagentSnapshots?: SubagentSnapshot[];
}

const sessionsDir = join(homedir(), ".RJ", "sessions");

const sessionPath = (id: string): string => join(sessionsDir, `${id}.json`);

const ensureDir = (): void => {
  mkdirSync(sessionsDir, { recursive: true });
};

const ensureSafeSessionTitle = (title: string): string => {
  const normalized = title.trim();
  if (!normalized || normalized.startsWith("/")) return "Untitled";
  return normalized;
};

/** 从第一条用户消息提取会话标题（最多30字符） */
const extractTitle = (uiMessages: Message[]): string => {
  const first = uiMessages.find((m) => m.kind === "user");
  if (!first?.text) return "Untitled";
  return ensureSafeSessionTitle(first.text.slice(0, 30) + (first.text.length > 30 ? "…" : ""));
};

/** 生成唯一会话 ID */
export const generateSessionId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** 保存会话到磁盘 */
export const saveSession = (
  id: string,
  sessionMessages: ChatHistoryMessage[],
  uiMessages: Message[],
  createdAt: Date,
  title?: string,
  subagentSnapshots?: SubagentSnapshot[],
): void => {
  ensureDir();
  const existing = loadSession(id);
  const record: SessionRecord = {
    id,
    title: ensureSafeSessionTitle(title ?? existing?.title ?? extractTitle(uiMessages)),
    createdAt: existing?.createdAt ?? createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
    sessionMessages,
    uiMessages,
    subagentSnapshots,
  };
  writeFileSync(sessionPath(id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
};

/** 用 AI 为会话生成简短标题（最多10个字），失败时返回 null */
export const generateSessionTitle = async (
  provider: RJProviderConfig,
  model: string,
  userText: string,
): Promise<string | null> => {
  if (!provider.baseURL || !provider.apiKey) return null;
  try {
    const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey });
    const response = await client.chat.completions.create({
      model,
      max_tokens: 30,
      messages: [
        {
          role: "user",
          content: `为以下对话内容生成一个简短标题，要求：10个字以内，不加引号，不加标点，直接输出标题文字。\n\n对话内容：${userText.slice(0, 200)}`,
        },
      ],
    });
    const title = response.choices[0]?.message?.content?.trim();
    return title ? ensureSafeSessionTitle(title) : null;
  } catch {
    return null;
  }
};

/** 从磁盘加载单个会话，不存在或解析失败返回 null */
export const loadSession = (id: string): SessionRecord | null => {
  const p = sessionPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionRecord;
  } catch {
    return null;
  }
};

/** 列出所有会话，按 updatedAt 降序排列 */
export const listSessions = (): SessionRecord[] => {
  ensureDir();
  const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
  const records: SessionRecord[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(sessionsDir, file), "utf8")) as SessionRecord;
      if (raw.id && raw.title) records.push(raw);
    } catch {
      // 跳过损坏文件
    }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};
