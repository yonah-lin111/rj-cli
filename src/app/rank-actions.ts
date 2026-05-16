import type { RankSelection } from "../ui/rank-selector.ts";
import type { OpenUrlCommand } from "./open-url.ts";
import type { ChatSubmission } from "./command-prompts.ts";
import { buildRankCommandPrompt } from "./command-prompts.ts";
import { buildRankPageUrl, ensureRankPageServer } from "./open-url.ts";

export type RankActionDeps = {
  rankPageServer?: import("node:http").Server;
  openUrlCommand?: OpenUrlCommand;
  detectOpenUrlCommand: () => OpenUrlCommand;
  openUrl: (url: string, opener: OpenUrlCommand) => Promise<void>;
  submitChat: (submission: ChatSubmission) => Promise<void>;
};

export const handleRankSelectionAction = async (
  selection: RankSelection,
  deps: RankActionDeps,
): Promise<{ rankPageServer?: import("node:http").Server; openUrlCommand?: OpenUrlCommand }> => {
  if (selection.openPage) {
    return await openRankPageAction(selection, deps);
  }

  await deps.submitChat(buildRankCommandPrompt(selection));
  return {};
};

export const openRankPageAction = async (
  selection: RankSelection,
  deps: RankActionDeps,
): Promise<{ rankPageServer: import("node:http").Server; openUrlCommand: OpenUrlCommand }> => {
  const rankPageServer = await ensureRankPageServer(deps.rankPageServer);
  const address = rankPageServer.address() as import("node:net").AddressInfo;
  const url = buildRankPageUrl(address, selection.rankingType, selection.pageSize);
  const openUrlCommand = deps.openUrlCommand ?? deps.detectOpenUrlCommand();
  await deps.openUrl(url, openUrlCommand);
  return { rankPageServer, openUrlCommand };
};
