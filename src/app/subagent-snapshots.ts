import type { RJSubagentConfig } from "../core/config.ts";
import { createSubagentSnapshot, type SubagentSnapshot } from "../ui/subagent-view.ts";

export const createResolvedSubagentSnapshot = (
  snapshots: Map<string, SubagentSnapshot>,
  agent: RJSubagentConfig,
  task: string,
): { snapshot: SubagentSnapshot; action: "new" } => {
  const id = `${agent.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const snapshot = createSubagentSnapshot(agent, task.slice(0, 80), id);
  snapshots.set(id, snapshot);
  return { snapshot, action: "new" };
};

export const resolveSubagentSnapshot = (
  snapshots: Map<string, SubagentSnapshot>,
  agent: RJSubagentConfig,
  task: string,
  reuseMode: "auto" | "reuse" | "new",
  subagentId?: string,
): { snapshot: SubagentSnapshot; action: "new" | "reuse" } | { error: string } => {
  if (subagentId) {
    const snapshot = snapshots.get(subagentId);
    if (!snapshot) return { error: `Subagent not found: ${subagentId}` };
    if (snapshot.agentId !== agent.id) return { error: `Subagent ${subagentId} belongs to ${snapshot.agentId}, not ${agent.id}.` };
    if (snapshot.status === "running") return { error: `Subagent ${subagentId} is busy.` };
    if (reuseMode === "new") return createResolvedSubagentSnapshot(snapshots, agent, task);
    return { snapshot, action: "reuse" };
  }

  if (reuseMode === "new") return createResolvedSubagentSnapshot(snapshots, agent, task);

  const reusable = [...snapshots.values()]
    .filter((snapshot) => snapshot.agentId === agent.id && snapshot.status !== "running")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  if (reusable) return { snapshot: reusable, action: "reuse" };
  if (reuseMode === "reuse") return { error: `No reusable ${agent.name} subagent is available.` };
  return createResolvedSubagentSnapshot(snapshots, agent, task);
};
