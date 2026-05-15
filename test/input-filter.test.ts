import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldIgnoreImeIntermediate } from "../src/utils/input-filter.ts";

test("共享输入过滤逻辑不会拦截普通英文", () => {
  assert.equal(shouldIgnoreImeIntermediate("a"), false);
  assert.equal(shouldIgnoreImeIntermediate("RJ123"), false);
});

test("共享输入过滤逻辑不会拦截普通数字", () => {
  assert.equal(shouldIgnoreImeIntermediate("1"), false);
  assert.equal(shouldIgnoreImeIntermediate("9"), false);
});

test("共享输入过滤逻辑会忽略 kitty ASCII 拼音中间态", () => {
  assert.equal(shouldIgnoreImeIntermediate("\u001b[110;1u"), true);
  assert.equal(shouldIgnoreImeIntermediate("\u001b[115;1u"), true);
});

test("共享输入过滤逻辑不会拦截最终中文输入", () => {
  assert.equal(shouldIgnoreImeIntermediate("\u001b[20320;1u"), false);
  assert.equal(shouldIgnoreImeIntermediate("\u001b[22909;1u"), false);
});
