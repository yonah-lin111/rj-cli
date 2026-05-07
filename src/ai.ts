import OpenAI from "openai";
import type { RJProviderConfig } from "./config.js";

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface CompleteChatOptions {
  provider: RJProviderConfig;
  model: string;
  messages: ChatHistoryMessage[];
  maxTokens: number;
}

export async function completeChat(options: CompleteChatOptions): Promise<string> {
  const { provider, model, messages, maxTokens } = options;
  if (!provider.baseURL) throw new Error(`Provider ${provider.name} is missing baseURL.`);
  if (!provider.apiKey) throw new Error(`Provider ${provider.name} is missing apiKey.`);

  const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey });
  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
  });

  const content = response.choices[0]?.message.content?.trim();

  if (!content) throw new Error("AI response was empty.");
  return content;
}
