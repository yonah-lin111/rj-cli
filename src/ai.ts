import OpenAI from "openai";
import type { RJProviderConfig } from "./config.js";

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface StreamChatOptions {
  provider: RJProviderConfig;
  model: string;
  messages: ChatHistoryMessage[];
  maxTokens: number;
  onDelta: (delta: ChatDelta) => void;
}

export interface ChatDelta {
  content?: string;
  thinking?: string;
}

const maxAllowedOutputTokens = 32768;
const thinkingDeltaKeys = ["reasoning_content", "reasoning", "reasoning_text", "thinking"];

function clampMaxTokens(value: number): number {
  if (!Number.isFinite(value)) return maxAllowedOutputTokens;
  return Math.min(maxAllowedOutputTokens, Math.max(1, Math.floor(value)));
}

function readTextField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { provider, model, messages, maxTokens, onDelta } = options;
  if (!provider.baseURL) throw new Error(`Provider ${provider.name} is missing baseURL.`);
  if (!provider.apiKey) throw new Error(`Provider ${provider.name} is missing apiKey.`);

  const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey });
  const stream = await client.chat.completions.create({
    model,
    messages,
    max_tokens: clampMaxTokens(maxTokens),
    stream: true,
  });

  let hasOutput = false;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    const deltaRecord = delta as Record<string, unknown>;
    const content = typeof delta.content === "string" ? delta.content : undefined;
    const thinking = readTextField(deltaRecord, thinkingDeltaKeys);
    if (!content && !thinking) continue;

    hasOutput = true;
    onDelta({ content, thinking });
  }

  if (!hasOutput) throw new Error("AI response was empty.");
}
