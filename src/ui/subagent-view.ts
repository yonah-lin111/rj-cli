import type { ChatHistoryMessage } from "../core/ai.ts";
import type { RJSubagentConfig } from "../core/config.ts";
import type { SubagentToolEntry } from "../subagent/runner.ts";
import type { Message } from "./messages.ts";

/** subagent 执行快照，用于重新打开时展示历史 */
export interface SubagentSnapshot {
  id: string;
  agentId: string;
  agentName: string;
  taskDescription: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
  conversationHistory: ChatHistoryMessage[];
  /** AI 生成的简短 title，完成后更新 */
  title: string;
  fullOutput: string;
  toolEntries: SubagentToolEntry[];
  status: "running" | "done" | "error";
  errorMessage?: string;
  /** 用于 MessagesView 渲染的消息列表 */
  messages: Message[];
}

/**
 * 从 RJSubagentConfig 和任务描述创建初始快照。
 */
export const createSubagentSnapshot = (
  agent: RJSubagentConfig,
  taskDescription: string,
  id: string,
): SubagentSnapshot => {
  const now = new Date().toISOString();
  return {
    id,
    agentId: agent.id,
    agentName: agent.name,
    taskDescription,
    createdAt: now,
    updatedAt: now,
    lastRunAt: undefined,
    runCount: 0,
    conversationHistory: [],
    title: "",
    fullOutput: "",
    toolEntries: [],
    status: "running",
    messages: [{ kind: "user", text: taskDescription, label: "main" }],
  };
};
