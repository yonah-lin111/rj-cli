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

/** todowrite tool 的 OpenAI schema */
export const todoWriteToolSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "todowrite",
    description:
      "Create and manage a structured todo list for the current coding session. Use for multi-step work to track progress.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The updated todo list.",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "Brief description of the task.",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
                description: "Current status of the task.",
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Priority level of the task.",
              },
            },
            required: ["content", "status", "priority"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
  },
};

/** rj_get_ranking tool 的 OpenAI schema */
export const rjGetRankingSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_get_ranking",
    description: "获取 DLsite 排行榜数据，支持按时间段、RJ号、标题、社团、CV筛选。",
    parameters: {
      type: "object",
      properties: {
        ranking_type: {
          type: "string",
          enum: ["24h", "7d", "30d", "year"],
          description: "排行榜时间段：24h/7d/30d/year。",
        },
        page: { type: "number", description: "页码，默认 1。" },
        page_size: { type: "number", description: "每页数量，默认 20，最大 100。" },
        rj_code: { type: "string", description: "按 RJ 号筛选。" },
        title: { type: "string", description: "按标题模糊查询。" },
        circle: { type: "string", description: "按社团名模糊查询。" },
        cv: { type: "string", description: "按 CV 声优模糊查询。" },
      },
      required: ["ranking_type"],
      additionalProperties: false,
    },
  },
};

/** rj_query tool 的 OpenAI schema */
export const rjQuerySchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_query",
    description: "查询本地数据库中已收录的 RJ 作品，支持多条件筛选和分页。",
    parameters: {
      type: "object",
      properties: {
        page: { type: "number", description: "页码，默认 1。" },
        page_size: { type: "number", description: "每页数量，默认 20，最大 100。" },
        rj_code: { type: "string", description: "按 RJ 号筛选。" },
        title: { type: "string", description: "按标题模糊查询。" },
        circle: { type: "string", description: "按社团名模糊查询。" },
        cv: { type: "string", description: "按 CV 声优模糊查询。" },
        source: { type: "string", description: "按资源来源筛选。" },
        status: { type: "number", description: "按下载状态筛选。" },
        release_date_start: { type: "string", description: "发售开始日期（YYYY-MM-DD）。" },
        release_date_end: { type: "string", description: "发售结束日期（YYYY-MM-DD）。" },
        created_at_start: { type: "string", description: "添加开始日期（YYYY-MM-DD）。" },
        created_at_end: { type: "string", description: "添加结束日期（YYYY-MM-DD）。" },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const circleQuerySchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_query",
    description: "查询本地数据库中已收录的社团，支持分页和可选条件筛选，返回作品数量统计。",
    parameters: {
      type: "object",
      properties: {
        page: { type: "number", description: "页码，默认 1。" },
        page_size: { type: "number", description: "每页数量，默认 20，最大 100。" },
        name: { type: "string", description: "按社团名模糊查询。" },
        nickname: { type: "string", description: "按昵称模糊查询。" },
        remark: { type: "string", description: "按备注模糊查询。" },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const circleGetDetailSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_get_detail",
    description: "获取本地数据库中指定社团的详情和作品数量。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "社团名。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
};

export const circleUpdateSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_update",
    description: "更新社团昵称、链接和备注，不支持改名。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "社团名，用于定位记录。" },
        nickname: { type: "string", description: "社团昵称，空值将回退为社团名。" },
        circle_url: { type: ["string", "null"], description: "社团链接，空字符串或 null 会清空。" },
        remark: { type: ["string", "null"], description: "备注，空字符串或 null 会清空。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
};

export const circleQueryWorksSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_query_works",
    description: "查询本地数据库中属于指定社团的 RJ 作品，支持 RJ 号、标题筛选和分页。",
    parameters: {
      type: "object",
      properties: {
        circle_name: { type: "string", description: "社团名。" },
        page: { type: "number", description: "页码，默认 1。" },
        page_size: { type: "number", description: "每页数量，默认 20，最大 100。" },
        rj_code: { type: "string", description: "按 RJ 号筛选。" },
        title: { type: "string", description: "按标题模糊查询。" },
      },
      required: ["circle_name"],
      additionalProperties: false,
    },
  },
};

export const circleAddWorkSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_add_work",
    description: "将本地数据库中已存在的 RJ 作品关联到指定社团。",
    parameters: {
      type: "object",
      properties: {
        circle_name: { type: "string", description: "社团名。" },
        rj_code: { type: "string", description: "RJ 号，如 RJ123456。" },
      },
      required: ["circle_name", "rj_code"],
      additionalProperties: false,
    },
  },
};

export const circleRemoveWorkSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_remove_work",
    description: "从指定社团移除本地 RJ 作品关联，不删除作品记录。",
    parameters: {
      type: "object",
      properties: {
        circle_name: { type: "string", description: "社团名。" },
        rj_code: { type: "string", description: "RJ 号，如 RJ123456。" },
      },
      required: ["circle_name", "rj_code"],
      additionalProperties: false,
    },
  },
};

export const circleGetLatestWorksSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_get_latest_works",
    description: "爬取指定社团在 DLsite 上最新发布的作品列表（需要社团已设置 circle_url）。",
    parameters: {
      type: "object",
      properties: {
        circle_name: { type: "string", description: "社团名，必须与本地数据库中的社团名一致。" },
        limit: { type: "number", description: "返回数量，默认 10，最多 20。" },
      },
      required: ["circle_name"],
      additionalProperties: false,
    },
  },
};

/** rj_get_detail tool 的 OpenAI schema */
export const rjGetDetailSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_get_detail",
    description: "获取本地数据库中指定 RJ 号的作品详情。",
    parameters: {
      type: "object",
      properties: {
        rj_code: { type: "string", description: "RJ 号，如 RJ123456。" },
      },
      required: ["rj_code"],
      additionalProperties: false,
    },
  },
};

/** rj_get_overview tool 的 OpenAI schema */
export const rjGetOverviewSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_get_overview",
    description: "获取数据概览看板，包含作品总数、状态分布等统计信息。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};

export const rjAddSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_add",
    description: "从排行榜缓存或抓取结果中添加指定 RJ 到本地数据库。",
    parameters: {
      type: "object",
      properties: {
        rj_code: { type: "string", description: "RJ 号，如 RJ123456。" },
        ranking_type: { type: "string", enum: ["24h", "7d", "30d", "year"], description: "排行榜时间段。" },
        source: { type: "string", description: "可选来源，默认 ranking:<ranking_type>。" },
      },
      required: ["rj_code", "ranking_type"],
      additionalProperties: false,
    },
  },
};

export const rjRemoveSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_remove",
    description: "从本地数据库删除指定 RJ。",
    parameters: {
      type: "object",
      properties: {
        rj_code: { type: "string", description: "RJ 号，如 RJ123456。" },
      },
      required: ["rj_code"],
      additionalProperties: false,
    },
  },
};

export const rjCheckExistsSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_check_exists",
    description: "批量检查 RJ 是否已存在于本地数据库。",
    parameters: {
      type: "object",
      properties: {
        rj_codes: { type: "array", items: { type: "string" }, description: "RJ 号列表。" },
      },
      required: ["rj_codes"],
      additionalProperties: false,
    },
  },
};

export const circleAddSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_add",
    description: "添加社团到本地社团库，已存在时不会重复插入。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "社团名。" },
        circle_url: { type: "string", description: "社团链接。" },
        nickname: { type: "string", description: "社团昵称，默认等于社团名。" },
        remark: { type: "string", description: "备注。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
};

export const circleRemoveSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_remove",
    description: "从本地社团库删除指定社团。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "社团名。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
};

export const circleCheckExistsSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "circle_check_exists",
    description: "批量检查社团是否已存在于本地社团库。",
    parameters: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" }, description: "社团名列表。" },
      },
      required: ["names"],
      additionalProperties: false,
    },
  },
};

/** ask tool 的 OpenAI schema */
export const askToolSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "ask",
    description:
      "Ask the user one or more questions during execution. Use to gather preferences, clarify ambiguous instructions, or get decisions on implementation choices. Each question has a list of options; the user can select one (or multiple if multiple=true) or type a custom answer.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Questions to ask the user.",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The complete question to ask. Should be clear and end with a question mark.",
              },
              header: {
                type: "string",
                description: "Very short label shown as the question title (max 30 chars).",
              },
              options: {
                type: "array",
                description: "Available choices for the user.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Display text (1-5 words, concise)." },
                    description: { type: "string", description: "Explanation of this choice." },
                  },
                  required: ["label", "description"],
                  additionalProperties: false,
                },
              },
              multiple: {
                type: "boolean",
                description: "Allow selecting multiple choices. Default false.",
              },
              custom: {
                type: "boolean",
                description: "Allow typing a custom answer. Default true. When enabled, do not include an 'Other' option.",
              },
            },
            required: ["question", "header", "options"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
};

/** explore subagent tool 的 OpenAI schema */
export const exploreToolSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "explore",
    description:
      "Delegate file exploration to a specialized subagent. Use when you need to read and analyze multiple files to understand code structure, find implementations, or gather context. Prefer reusing a same-topic subagent with reuseMode auto/reuse so it can continue from prior context; use reuseMode new for unrelated topics or when previous context may contaminate results. The subagent will read files and return a summary.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Description of what to explore or find. Be specific about which files or patterns to look for.",
        },
        reuseMode: {
          type: "string",
          enum: ["auto", "reuse", "new"],
          description: "auto (default) reuses the latest non-running same-type subagent or creates one; reuse requires an existing match; new always creates a fresh subagent.",
        },
        subagentId: {
          type: "string",
          description: "Optional existing subagent id to reuse when reuseMode is reuse or auto.",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
};

/** rj_work_ops_preview tool 的 OpenAI schema */
export const rjWorkOpsPreviewSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_work_ops_preview",
    description: "预览作品处理结果：从文件夹名提取RJ号，匹配数据库中的作品信息，扫描音频/图片文件，返回预览数据（输出路径、文件列表等）。在执行 rj_work_ops_process 前必须先调用此工具。",
    parameters: {
      type: "object",
      properties: {
        source_path: { type: "string", description: "源文件夹路径，文件夹名需包含RJ号（如 RJ123456）。" },
        target_format: { type: "string", enum: ["flac", "mp3", "none"], description: "目标格式：flac、mp3 或 none（不转换）。" },
        output_base_path: { type: "string", description: "输出基础路径，留空则输出到源文件夹同级目录。" },
        multi_folder: { type: "boolean", description: "多音声文件夹模式，源文件夹下有多个子文件夹时使用。默认 false。" },
      },
      required: ["source_path", "target_format"],
      additionalProperties: false,
    },
  },
};

/** rj_work_ops_process tool 的 OpenAI schema */
export const rjWorkOpsProcessSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "rj_work_ops_process",
    description: "执行作品格式转换和文件整理，实时返回进度。调用前必须先用 rj_work_ops_preview 预览，并通过 ask 工具向用户确认参数。",
    parameters: {
      type: "object",
      properties: {
        source_path: { type: "string", description: "源文件夹路径。" },
        target_format: { type: "string", enum: ["flac", "mp3", "none"], description: "目标格式。" },
        keep_source: { type: "boolean", description: "是否保留源文件，默认 true。" },
        threads: { type: "number", description: "并发转换线程数，1-8，默认 2。" },
        output_base_path: { type: "string", description: "输出基础路径。" },
        force_overwrite: { type: "boolean", description: "是否强制覆盖已存在的输出目录，默认 false。" },
        multi_folder: { type: "boolean", description: "多音声文件夹模式，默认 false。" },
        selected_folders: { type: "array", items: { type: "string" }, description: "多文件夹模式下选中的子文件夹名称列表。" },
        cover_image: { type: "string", description: "自定义封面文件名（可选）。" },
      },
      required: ["source_path", "target_format", "keep_source", "threads", "output_base_path"],
      additionalProperties: false,
    },
  },
};

/** bash tool 的 OpenAI schema */
export const bashToolSchema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "bash",
    description:
      "Run a non-interactive shell command in the current working directory. Use for project scripts, tests, builds, or simple commands. Do not use for interactive commands or long-running background processes.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Non-interactive shell command to run.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};
