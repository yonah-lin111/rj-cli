import OpenAI from "openai";
import type { RJProviderConfig } from "./config.ts";

/** tool call 请求（AI 发起） */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** assistant 结构化内容块 */
export type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; toolCall: ToolCall };

/** AI 对话历史消息 */
export type ChatHistoryMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content?: string; blocks?: AssistantContentBlock[]; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; toolName?: string; isError?: boolean };

/** 单次流式增量内容 */
export interface ChatDelta {
  content?: string;
  thinking?: string;
}

/** tool 执行结果（由调用方提供） */
export interface ToolResult {
  tool_call_id: string;
  toolName?: string;
  content: string;
  isError?: boolean;
}

/** tool calling 流式调用选项 */
interface StreamChatOptions {
  provider: RJProviderConfig;
  model: string;
  messages: ChatHistoryMessage[];
  maxTokens: number;
  tools: OpenAI.Chat.ChatCompletionTool[];
  signal?: AbortSignal;
  /** 每轮 AI 请求开始前调用，用于在 UI 新增一个 segment */
  onTurn: () => void;
  onDelta: (delta: ChatDelta) => void;
  onToolCalls: (calls: ToolCall[]) => Promise<ToolResult[]>;
  /** 每轮完整结构化消息生成后回调给上层持久化会话历史 */
  onHistoryMessage?: (message: ChatHistoryMessage) => void;
}

/** 单次请求允许的最大输出 token 数 */
const maxAllowedOutputTokens = 32768;

/** 各提供商思考内容字段名（兼容多种 API） */
const thinkingDeltaKeys = ["reasoning_content", "reasoning", "reasoning_text", "thinking"];

const clampMaxTokens = (value: number): number => {
  if (!Number.isFinite(value)) return maxAllowedOutputTokens;
  return Math.min(maxAllowedOutputTokens, Math.max(1, Math.floor(value)));
};

const readTextField = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
};

const assistantTextContent = (message: Extract<ChatHistoryMessage, { role: "assistant" }>): string => {
  if (message.blocks?.length) {
    return message.blocks
      .filter((block): block is Extract<AssistantContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
  return message.content ?? "";
};

const assistantToolCalls = (message: Extract<ChatHistoryMessage, { role: "assistant" }>): ToolCall[] => {
  const blockCalls = message.blocks
    ?.filter((block): block is Extract<AssistantContentBlock, { type: "toolCall" }> => block.type === "toolCall")
    .map((block) => block.toolCall) ?? [];
  return blockCalls.length > 0 ? blockCalls : (message.tool_calls ?? []);
};

/** 将内部结构化消息转换为 OpenAI-compatible chat messages。 */
export const toOpenAIChatMessages = (messages: ChatHistoryMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] =>
  messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: message.tool_call_id,
        content: message.content,
      };
    }

    if (message.role === "assistant") {
      const toolCalls = assistantToolCalls(message);
      if (toolCalls.length > 0) {
        const content = assistantTextContent(message);
        return {
          role: "assistant" as const,
          content: content || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      return { role: "assistant" as const, content: assistantTextContent(message) };
    }

    return { role: message.role, content: message.content };
  });

const buildAssistantMessage = (content: string, thinking: string, toolCalls: ToolCall[]): ChatHistoryMessage => {
  const blocks: AssistantContentBlock[] = [];
  if (thinking) blocks.push({ type: "thinking", thinking });
  if (content) blocks.push({ type: "text", text: content });
  for (const toolCall of toolCalls) blocks.push({ type: "toolCall", toolCall });

  return {
    role: "assistant",
    content,
    blocks,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
};

const buildToolResultMessage = (result: ToolResult): ChatHistoryMessage => ({
  role: "tool",
  tool_call_id: result.tool_call_id,
  toolName: result.toolName,
  content: result.content,
  isError: result.isError,
});

/**
 * 以流式方式调用 AI，支持 tool calling 循环。
 * 当 AI 返回 tool_calls 时，调用 onToolCalls 执行工具，将结果追加到历史后继续请求。
 */
export const streamChat = async (options: StreamChatOptions): Promise<void> => {
  const { provider, model, maxTokens, tools, signal, onTurn, onDelta, onToolCalls, onHistoryMessage } = options;
  if (!provider.baseURL) throw new Error(`Provider ${provider.name} is missing baseURL.`);
  if (!provider.apiKey) throw new Error(`Provider ${provider.name} is missing apiKey.`);

  const client = new OpenAI({ baseURL: provider.baseURL, apiKey: provider.apiKey });
  const history: ChatHistoryMessage[] = [...options.messages];

  for (;;) {
    onTurn();
    const openaiMessages = toOpenAIChatMessages(history);

    const stream = await client.chat.completions.create(
      {
        model,
        messages: openaiMessages,
        max_tokens: clampMaxTokens(maxTokens),
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
      },
      { signal },
    );

    let hasOutput = false;
    let assistantContent = "";
    let assistantThinking = "";
    const pendingToolCalls: Record<number, { id: string; name: string; arguments: string }> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      const deltaRecord = delta as Record<string, unknown>;
      const content = typeof delta.content === "string" ? delta.content : undefined;
      const thinking = readTextField(deltaRecord, thinkingDeltaKeys);

      if (content) {
        assistantContent += content;
        hasOutput = true;
        onDelta({ content });
      }
      if (thinking) {
        assistantThinking += thinking;
        hasOutput = true;
        onDelta({ thinking });
      }

      const toolCallDeltas = delta.tool_calls;
      if (toolCallDeltas) {
        for (const tc of toolCallDeltas) {
          const idx = tc.index ?? 0;
          if (!pendingToolCalls[idx]) {
            pendingToolCalls[idx] = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
          }
          if (tc.id) pendingToolCalls[idx].id = tc.id;
          if (tc.function?.name && !pendingToolCalls[idx].name) pendingToolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) pendingToolCalls[idx].arguments += tc.function.arguments;
        }
        hasOutput = true;
      }
    }

    const toolCallList = Object.values(pendingToolCalls);
    const assistantMessage = buildAssistantMessage(assistantContent, assistantThinking, toolCallList);

    if (toolCallList.length === 0) {
      if (!hasOutput) throw new Error("AI response was empty.");
      history.push(assistantMessage);
      onHistoryMessage?.(assistantMessage);
      break;
    }

    history.push(assistantMessage);
    onHistoryMessage?.(assistantMessage);

    const results = await onToolCalls(toolCallList);
    for (const result of results) {
      const resultMessage = buildToolResultMessage(result);
      history.push(resultMessage);
      onHistoryMessage?.(resultMessage);
    }
  }
};

/** write_file tool 的 OpenAI schema */
export const writeFileTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "write_file",
    description:
      "Create a new file or overwrite an existing file with the given content. Parent directories are created automatically.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the working directory (or absolute).",
        },
        content: {
          type: "string",
          description: "Full content to write to the file.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
};

/** edit_file tool 的 OpenAI schema */
export const editFileTool: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "edit_file",
    description:
      "Apply one or more exact string replacements to an existing file. Each oldText must appear exactly once in the file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the working directory (or absolute).",
        },
        edits: {
          type: "array",
          description: "List of replacements to apply.",
          items: {
            type: "object",
            properties: {
              oldText: {
                type: "string",
                description: "Exact text to find (must be unique in the file).",
              },
              newText: {
                type: "string",
                description: "Text to replace it with.",
              },
            },
            required: ["oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      required: ["path", "edits"],
      additionalProperties: false,
    },
  },
};

/** read_file tool 的 OpenAI schema */
export const readFileToolSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read the contents of a file. Use this before editing to understand the current content.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the working directory (or absolute).",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};
