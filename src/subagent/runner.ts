import OpenAI from "openai";
import { streamChat, readFileToolSchema, type ChatHistoryMessage, type ToolCall, type ToolResult, type ChatDelta } from "../core/ai.ts";
import { readFileTool } from "../tools/base/file-writer.ts";
import type { RJProviderConfig, RJSubagentConfig } from "../core/config.ts";

/** subagent 单次工具调用记录 */
export interface SubagentToolEntry {
  label: string;
  isError: boolean;
}

/** subagent 执行结果 */
export interface SubagentResult {
  fullOutput: string;
  toolEntries: SubagentToolEntry[];
  /** AI 生成的结构化总结，注入主 agent 上下文 */
  summary: string;
  /** 从输出首行提取的简短 title */
  title: string;
  /** 可复用的真实探索对话历史，不包含总结请求和总结回答 */
  conversationHistory: ChatHistoryMessage[];
}

/** subagent 流式输出回调 */
export interface SubagentCallbacks {
  onTurn?: () => void;
  onDelta?: (delta: ChatDelta) => void;
  onToolCall?: (callId: string, toolName: string, label: string) => void;
  onToolResult?: (callId: string, label: string, isError: boolean) => void;
  /** 总结阶段的流式增量，用于在 subagent 页面展示总结内容 */
  onSummaryTurn?: () => void;
  onSummaryDelta?: (delta: ChatDelta) => void;
}

/**
 * 从输出首行提取简短 title，截断到 60 字符。
 */
const extractTitle = (fullOutput: string, taskDescription: string): string => {
  const lines = fullOutput.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
    if (clean.length >= 4) return clean.slice(0, 60);
  }
  return taskDescription.slice(0, 60);
};

const SUMMARY_PROMPT =
  "Based on your exploration above, write a concise structured summary for the main agent. " +
  "Include: key findings, relevant file paths, important code patterns or decisions found. " +
  "Be specific and factual. Do not repeat the full file contents.";

export const runSubagent = async (
  agent: RJSubagentConfig,
  userMessage: string,
  provider: RJProviderConfig,
  modelId: string,
  cwd: string,
  callbacks: SubagentCallbacks = {},
  signal?: AbortSignal,
  history: ChatHistoryMessage[] = [],
): Promise<SubagentResult> => {
  const explorationHistory: ChatHistoryMessage[] = [...history, { role: "user", content: userMessage }];
  const messages: ChatHistoryMessage[] = [
    { role: "system", content: agent.systemPrompt },
    ...explorationHistory,
  ];

  let fullOutput = "";
  const toolEntries: SubagentToolEntry[] = [];

  await streamChat({
    provider,
    model: modelId,
    messages,
    maxTokens: 8192,
    tools: [readFileToolSchema],
    signal,
    onTurn: () => {
      callbacks.onTurn?.();
    },
    onDelta: (delta) => {
      if (delta.content) fullOutput += delta.content;
      callbacks.onDelta?.(delta);
    },
    onToolCalls: async (calls: ToolCall[]): Promise<ToolResult[]> => {
      const results: ToolResult[] = [];
      for (const call of calls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          toolEntries.push({ label: "Invalid arguments", isError: true });
          callbacks.onToolCall?.(call.id, call.name, "Invalid arguments");
          callbacks.onToolResult?.(call.id, "Invalid arguments", true);
          results.push({ tool_call_id: call.id, toolName: call.name, content: "Invalid tool arguments", isError: true });
          continue;
        }

        const path = typeof args.path === "string" ? args.path : "";
        const callLabel = `Read ${path}`;
        const entry: SubagentToolEntry = { label: callLabel, isError: false };
        toolEntries.push(entry);
        callbacks.onToolCall?.(call.id, call.name, callLabel);

        try {
          const result = await readFileTool(path, cwd);
          entry.label = path;
          callbacks.onToolResult?.(call.id, path, false);
          results.push({ tool_call_id: call.id, toolName: call.name, content: result.content });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          entry.label = msg;
          entry.isError = true;
          callbacks.onToolResult?.(call.id, msg, true);
          results.push({ tool_call_id: call.id, toolName: call.name, content: msg, isError: true });
        }
      }
      return results;
    },
    onHistoryMessage: (message) => {
      messages.push(message);
      explorationHistory.push(message);
    },
  });

  const summaryMessages: ChatHistoryMessage[] = [
    ...messages,
    { role: "user", content: SUMMARY_PROMPT },
  ];
  let summary = "";

  await streamChat({
    provider,
    model: modelId,
    messages: summaryMessages,
    maxTokens: 2048,
    tools: [],
    signal,
    onTurn: () => {
      callbacks.onSummaryTurn?.();
    },
    onDelta: (delta) => {
      if (delta.content) summary += delta.content;
      callbacks.onSummaryDelta?.(delta);
    },
    onToolCalls: async (): Promise<ToolResult[]> => [],
  });

  return {
    fullOutput,
    toolEntries,
    summary: summary.trim() || fullOutput.trim().slice(0, 2000),
    title: extractTitle(fullOutput, userMessage),
    conversationHistory: explorationHistory,
  };
};
