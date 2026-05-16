import { queryCircleTool } from "../tools/rj-server/index.ts";
import type { WorksSelection, WorksSelectorItem } from "../ui/works-selector.ts";
import type { OpenUrlCommand } from "./open-url.ts";
import type { ChatSubmission } from "./command-prompts.ts";
import { buildWorksCommandPrompt } from "./command-prompts.ts";
import { buildWorksPageUrl, ensureRankPageServer } from "./open-url.ts";

export type WorksActionDeps = {
  rankPageServer?: import("node:http").Server;
  openUrlCommand?: OpenUrlCommand;
  detectOpenUrlCommand: () => OpenUrlCommand;
  openUrl: (url: string, opener: OpenUrlCommand) => Promise<void>;
  submitChat: (submission: ChatSubmission) => Promise<void>;
};

export const loadWorksSelectorItems = (): { items: WorksSelectorItem[]; error?: string } => {
  const result = queryCircleTool({ page: 1, page_size: 500 });
  if (result.isError) return { items: [], error: result.content };
  const data = JSON.parse(result.content) as { data?: WorksSelectorItem[] };
  return { items: data.data ?? [] };
};

export const handleWorksSelectionAction = async (
  selection: WorksSelection,
  deps: WorksActionDeps,
): Promise<{ rankPageServer?: import("node:http").Server; openUrlCommand?: OpenUrlCommand }> => {
  if (selection.outputMode === "page") {
    return await openWorksPageAction(selection, deps);
  }

  await deps.submitChat(buildWorksCommandPrompt(selection));
  return {};
};

export const openWorksPageAction = async (
  selection: WorksSelection,
  deps: WorksActionDeps,
): Promise<{ rankPageServer: import("node:http").Server; openUrlCommand: OpenUrlCommand }> => {
  const rankPageServer = await ensureRankPageServer(deps.rankPageServer);
  const address = rankPageServer.address() as import("node:net").AddressInfo;
  const url = buildWorksPageUrl(address, selection.queryPreset, selection.circleName);
  const openUrlCommand = deps.openUrlCommand ?? deps.detectOpenUrlCommand();
  await deps.openUrl(url, openUrlCommand);
  return { rankPageServer, openUrlCommand };
};
