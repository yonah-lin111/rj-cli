import type { RJSubagentConfig } from "../core/config.ts";
import type { SubagentToolEntry } from "../subagent/runner.ts";
import type { Message } from "./messages.ts";

/** subagent 执行快照，用于重新打开时展示历史 */
export interface SubagentSnapshot {
  agentId: string;
  agentName: string;
  taskDescription: string;
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
): SubagentSnapshot => ({
  agentId: agent.id,
  agentName: agent.name,
  taskDescription,
  title: "",
  fullOutput: "",
  toolEntries: [],
  status: "running",
  messages: [{ kind: "user", text: taskDescription, label: "main" }],
});
