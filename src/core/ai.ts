import OpenAI from "openai";
import type { RJProviderConfig } from "./config.ts";

/** AI 对话历史消息 */
export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** 流式调用选项 */
interface StreamChatOptions {
  provider: RJProviderConfig;
  model: string;
  messages: ChatHistoryMessage[];
  maxTokens: number;
  signal?: AbortSignal;
  onDelta: (delta: ChatDelta) => void;
}

/** 单次流式增量内容 */
export interface ChatDelta {
  content?: string;
  thinking?: string;
}

/** 单次请求允许的最大输出 token 数 */
const maxAllowedOutputTokens = 32768;

/** 各提供商思考内容字段名（兼容多种 API） */
const thinkingDeltaKeys = ["reasoning_content", "reasoning", "reasoning_text", "thinking"];

/**
 * 将 maxTokens 限制在合法范围内。
 */
const clampMaxTokens = (value: number): number => {
  if (!Number.isFinite(value)) return maxAllowedOutputTokens;
  return Math.min(maxAllowedOutputTokens, Math.max(1, Math.floor(value)));
};

/**
 * 从 Record 中按候选 key 列表读取第一个非空字符串值。
 */
const readTextField = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
};

/**
 * 以流式方式调用 AI 模型，通过 onDelta 回调逐步返回内容和思考过程。
 * 响应为空时抛出错误。
 */
export const streamChat = async (options: StreamChatOptions): Promise<void> => {
  const { provider, model, messages, maxTokens, signal, onDelta } = options;
  if (!provider.baseURL) throw new Error(`Provider ${provider.name} is missing baseURL.`);
  if (!provider.apiKey) throw new Error(`Provider ${provider.name} is missing apiKey.`);

  const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey });
  const stream = await client.chat.completions.create(
    {
      model,
      messages,
      max_tokens: clampMaxTokens(maxTokens),
      stream: true,
    },
    { signal },
  );

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
};
