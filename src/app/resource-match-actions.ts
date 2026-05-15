import type { ResourceMatchSelection } from "../tools/rj-server/index.ts";
import type { ChatSubmission } from "./command-prompts.ts";
import { buildResourceMatchCommandPrompt } from "./command-prompts.ts";

export const handleResourceMatchSelectionAction = async (
  mode: "mega" | "asmrone",
  selection: ResourceMatchSelection,
  submitChat: (submission: ChatSubmission) => Promise<void>,
): Promise<void> => {
  await submitChat(buildResourceMatchCommandPrompt(mode, selection));
};
