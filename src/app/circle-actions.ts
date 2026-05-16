import { queryCircleTool } from "../tools/rj-server/index.ts";
import type { CircleSelection, CircleSelectorItem } from "../ui/circle-selector.ts";
import type { OpenUrlCommand } from "./open-url.ts";
import type { ChatSubmission } from "./command-prompts.ts";
import { buildCircleCommandPrompt } from "./command-prompts.ts";
import { buildCirclePageUrl, ensureRankPageServer } from "./open-url.ts";

export type CircleActionDeps = {
  rankPageServer?: import("node:http").Server;
  openUrlCommand?: OpenUrlCommand;
  detectOpenUrlCommand: () => OpenUrlCommand;
  openUrl: (url: string, opener: OpenUrlCommand) => Promise<void>;
  submitChat: (submission: ChatSubmission) => Promise<void>;
  addMessage: (kind: "system", text: string, label?: string) => void;
  requestRender: () => void;
};

export const loadCircleSelectorItems = (): { items: CircleSelectorItem[]; error?: string } => {
  const result = queryCircleTool({ page: 1, page_size: 500 });
  if (result.isError) return { items: [], error: result.content };
  const data = JSON.parse(result.content) as { data?: CircleSelectorItem[] };
  return { items: data.data ?? [] };
};

export const handleCircleSelectionAction = async (
  selection: CircleSelection,
  deps: CircleActionDeps,
): Promise<{ rankPageServer?: import("node:http").Server; openUrlCommand?: OpenUrlCommand }> => {
  if (selection.outputMode === "page") {
    return await openCirclePageAction(deps);
  }

  if (!selection.circleName) {
    deps.addMessage("system", "当前本地数据库中没有社团记录", "result");
    deps.requestRender();
    return {};
  }

  await deps.submitChat(buildCircleCommandPrompt(selection));
  return {};
};

export const openCirclePageAction = async (
  deps: Pick<CircleActionDeps, "rankPageServer" | "openUrlCommand" | "detectOpenUrlCommand" | "openUrl">,
): Promise<{ rankPageServer: import("node:http").Server; openUrlCommand: OpenUrlCommand }> => {
  const rankPageServer = await ensureRankPageServer(deps.rankPageServer);
  const address = rankPageServer.address() as import("node:net").AddressInfo;
  const url = buildCirclePageUrl(address);
  const openUrlCommand = deps.openUrlCommand ?? deps.detectOpenUrlCommand();
  await deps.openUrl(url, openUrlCommand);
  return { rankPageServer, openUrlCommand };
};
