import { runSubagent } from "../subagent/runner.ts";
import type { RJProviderConfig, RJSubagentConfig } from "../core/config.ts";
import type { AssistantSegment, Message, ToolCallEntry } from "../ui/messages.ts";
import type { SubagentSnapshot } from "../ui/subagent-view.ts";
import { resolveSubagentSnapshot } from "./subagent-snapshots.ts";

type RunExploreSubagentParams = {
  agent: RJSubagentConfig;
  task: string;
  toolEntry: ToolCallEntry;
  snapshots: Map<string, SubagentSnapshot>;
  reuseMode: "auto" | "reuse" | "new";
  subagentId?: string;
  provider: RJProviderConfig;
  modelId: string;
  cwd: string;
  activeAbortSignal?: AbortSignal;
  requestRender: () => void;
};

const firstSentence = (text: string): string => {
  const [sentence] = text.trim().split(/(?<=[。！？.!?])\s+|\n+/, 1);
  return (sentence || text.trim()).slice(0, 80);
};

export const runExploreSubagentWithSnapshot = async ({
  agent,
  task,
  toolEntry,
  snapshots,
  reuseMode,
  subagentId,
  provider,
  modelId,
  cwd,
  activeAbortSignal,
  requestRender,
}: RunExploreSubagentParams): Promise<{ content: string; isError: boolean }> => {
    const resolved = resolveSubagentSnapshot(snapshots, agent, task, reuseMode, subagentId);
    if ("error" in resolved) {
      toolEntry.status = "error";
      toolEntry.resultLabel = resolved.error;
      toolEntry.isError = true;
      return { content: resolved.error, isError: true };
    }

    const { snapshot, action } = resolved;
    const previousFullOutput = snapshot.fullOutput;
    const now = new Date().toISOString();
    snapshot.status = "running";
    snapshot.updatedAt = now;
    snapshot.lastRunAt = now;
    snapshot.errorMessage = undefined;
    if (action === "reuse") snapshot.messages.push({ kind: "user", text: task, label: "main" });
    toolEntry.subagentId = snapshot.id;
    toolEntry.subagentAction = action;
    toolEntry.subagentAgentId = agent.id;
    toolEntry.subagentToolCount = snapshot.toolEntries.length;
    toolEntry.subagentDetailLabel = `${action === "new" ? "New" : "Reuse"}: ${firstSentence(task)}`;
    toolEntry.callLabel = toolEntry.subagentDetailLabel;

    // 当前 subagent assistant 消息及其当前 segment（与主 agent 结构完全一致）
    let subagentAssistant: Message | undefined;
    let subagentSegment: AssistantSegment | undefined;
    // 追踪每个 tool call entry，按 callId 索引
    const pendingEntries = new Map<string, ToolCallEntry>();
    const pendingSpinners = new Map<string, NodeJS.Timeout>();

    try {
      const result = await runSubagent(
        agent,
        task,
        provider,
        modelId,
        cwd,
        {
          onTurn: () => {
            // 每轮新建一个 assistant 消息（或复用已有的），追加新 segment
            if (!subagentAssistant) {
              subagentAssistant = { kind: "assistant", text: "", label: `${agent.name}[subagent]`, segments: [] };
              snapshot.messages.push(subagentAssistant);
            }
            subagentSegment = { text: "" };
            subagentAssistant.segments!.push(subagentSegment);
            requestRender();
          },
          onDelta: (delta) => {
            if (!subagentSegment) return;
            if (delta.thinking) subagentSegment.thinking = `${subagentSegment.thinking ?? ""}${delta.thinking}`;
            if (delta.content) {
              subagentSegment.text += delta.content;
              snapshot.fullOutput += delta.content;
            }
            requestRender();
          },
          onToolCall: (callId, toolName, callLabel) => {
            if (!subagentSegment) return;
            toolEntry.subagentToolCount = (toolEntry.subagentToolCount ?? 0) + 1;
            toolEntry.subagentDetailLabel = callLabel;
            const entry: ToolCallEntry = { id: callId, name: toolName, status: "running", callLabel, spinnerFrame: 0 };
            subagentSegment.toolCalls = [...(subagentSegment.toolCalls ?? []), entry];
            pendingEntries.set(callId, entry);
            const timer = setInterval(() => {
              entry.spinnerFrame = ((entry.spinnerFrame ?? 0) + 1) % 10;
              requestRender();
            }, 80);
            pendingSpinners.set(callId, timer);
            requestRender();
          },
          onToolResult: (callId, label, isError) => {
            const entry = pendingEntries.get(callId);
            if (entry) {
              entry.status = isError ? "error" : "completed";
              entry.resultLabel = label;
              entry.isError = isError;
            }
            const timer = pendingSpinners.get(callId);
            if (timer) { clearInterval(timer); pendingSpinners.delete(callId); }
            requestRender();
          },
          onSummaryTurn: () => {
            // 总结阶段新建一个 user 消息作为分隔，再新建 assistant 消息承载总结
            snapshot.messages.push({ kind: "user", text: "Summary", label: "summary" });
            subagentAssistant = { kind: "assistant", text: "", label: `${agent.name}[subagent]`, segments: [] };
            snapshot.messages.push(subagentAssistant);
            subagentSegment = { text: "" };
            subagentAssistant.segments!.push(subagentSegment);
            requestRender();
          },
          onSummaryDelta: (delta) => {
            if (!subagentSegment) return;
            if (delta.content) subagentSegment.text += delta.content;
            requestRender();
          },
        },
        activeAbortSignal,
        snapshot.conversationHistory,
      );

      // 清理所有残留 spinner
      for (const timer of pendingSpinners.values()) clearInterval(timer);
      pendingSpinners.clear();

      const finishedAt = new Date().toISOString();
      snapshot.status = "done";
      snapshot.fullOutput = previousFullOutput + result.fullOutput;
      snapshot.toolEntries = [...snapshot.toolEntries, ...result.toolEntries];
      snapshot.title = result.title;
      snapshot.conversationHistory = result.conversationHistory;
      snapshot.runCount += 1;
      snapshot.updatedAt = finishedAt;
      snapshot.lastRunAt = finishedAt;
      toolEntry.callLabel = `${action === "new" ? "New" : "Reuse"}: ${result.title || firstSentence(task)}`;
      toolEntry.resultLabel = `${result.toolEntries.length} tools`;
      toolEntry.subagentTitle = snapshot.title;
      toolEntry.subagentToolCount = snapshot.toolEntries.length;
      toolEntry.subagentDetailLabel = `${action === "new" ? "New" : "Reuse"}: ${firstSentence(task)}`;
      requestRender();
      return { content: result.summary, isError: false };
    } catch (err) {
      for (const timer of pendingSpinners.values()) clearInterval(timer);
      pendingSpinners.clear();
      const msg = err instanceof Error ? err.message : String(err);
      snapshot.status = "error";
      snapshot.errorMessage = msg;
      snapshot.updatedAt = new Date().toISOString();
      toolEntry.resultLabel = msg.slice(0, 40);
      toolEntry.subagentDetailLabel = msg.slice(0, 80);
      snapshot.messages.push({ kind: "error", text: msg, label: "error" });
      requestRender();
      return { content: `Explore failed: ${msg}`, isError: true };
    }

};
