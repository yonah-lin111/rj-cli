import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionSelector } from "../src/ui/session-selector.ts";
import { shouldIgnoreImeIntermediate } from "../src/utils/input-filter.ts";

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

test("共享输入过滤逻辑不拦截英文和数字", () => {
  assert.equal(shouldIgnoreImeIntermediate("a"), false);
  assert.equal(shouldIgnoreImeIntermediate("1"), false);
  assert.equal(shouldIgnoreImeIntermediate("RJ123"), false);
});

test("/session 过滤时支持直接输入英文和数字", () => {
  const selector = createSelector();

  selector.handleInput("R");
  selector.handleInput("J");
  selector.handleInput("1");
  selector.handleInput("2");
  selector.handleInput("3");

  assert.equal(getSearchValue(selector), "RJ123");
});

test("/session 过滤时保留普通英文输入，并追加最终中文", () => {
  const selector = createSelector();

  selector.handleInput("n");
  selector.handleInput("i");
  selector.handleInput("h");
  selector.handleInput("a");
  selector.handleInput("o");
  selector.handleInput("\u001b[20320;1u");
  selector.handleInput("\u001b[22909;1u");

  assert.equal(getSearchValue(selector), "nihao你好");
});

test("/session 过滤时保留普通 ASCII 搜索词，并追加最终中文句子", () => {
  const selector = createSelector();

  selector.handleInput("n");
  selector.handleInput("s");
  selector.handleInput("s");
  selector.handleInput("\u001b[20320;1u");
  selector.handleInput("\u001b[26159;1u");
  selector.handleInput("\u001b[35841;1u");

  assert.equal(getSearchValue(selector), "nss你是谁");
});

test("/session 过滤时忽略 kitty ASCII 拼音中间态，仅显示最终中文", () => {
  const selector = createSelector();

  selector.handleInput("\u001b[110;1u");
  selector.handleInput("\u001b[115;1u");
  selector.handleInput("\u001b[115;1u");

  assert.equal(getSearchValue(selector), "");

  selector.handleInput("\u001b[20320;1u");
  selector.handleInput("\u001b[26159;1u");
  selector.handleInput("\u001b[35841;1u");

  assert.equal(getSearchValue(selector), "你是谁");
});
