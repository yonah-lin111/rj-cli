import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionSelector } from "../src/ui/session-selector.ts";

const getSearchValue = (selector: SessionSelector): string => {
  return (selector as unknown as { search: { getValue(): string } }).search.getValue();
};

const createSelector = (): SessionSelector => {
  return new SessionSelector(
    [{
      id: "1",
      title: "你是谁 你好世界",
      updatedAt: new Date("2026-05-14T00:00:00.000Z").toISOString(),
      savedAt: new Date("2026-05-14T00:00:00.000Z").toISOString(),
      preview: "",
      stats: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      messages: [],
      subagentSnapshots: [],
    }],
    () => {},
    () => {},
  );
};

test("/session 过滤时忽略拼音中间态，仅保留最终中文", () => {
  const selector = createSelector();

  selector.handleInput("n");
  selector.handleInput("i");
  selector.handleInput("h");
  selector.handleInput("a");
  selector.handleInput("o");
  selector.handleInput("\u001b[20320;1u");
  selector.handleInput("\u001b[22909;1u");

  assert.equal(getSearchValue(selector), "你好");
});

test("/session 过滤时忽略更长拼音串，仅保留最终中文句子", () => {
  const selector = createSelector();

  selector.handleInput("n");
  selector.handleInput("i");
  selector.handleInput("s");
  selector.handleInput("s");
  selector.handleInput("\u001b[20320;1u");
  selector.handleInput("\u001b[26159;1u");
  selector.handleInput("\u001b[35841;1u");

  assert.equal(getSearchValue(selector), "你是谁");
});
