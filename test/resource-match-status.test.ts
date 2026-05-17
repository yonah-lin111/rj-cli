import assert from "node:assert/strict";
import test from "node:test";
import { buildResourceMatchCommandPrompt } from "../src/app/command-prompts.ts";
import { getToolCallLabel } from "../src/app/tool-labels.ts";
import { rjSetSourceSchema } from "../src/core/ai.ts";
import { toolsPrompt } from "../src/prompts/tools/index.ts";

test("buildResourceMatchCommandPrompt 在单个 Mega 场景中要求先 ask 再更新 source", () => {
  const submission = buildResourceMatchCommandPrompt("mega", { matchAll: false, rjCode: "RJ123456" });

  assert.equal(submission.displayText, "/matchMega -RJ [RJ123456]");
  assert.match(submission.promptText, /先且只调用一次 match_mega_resources/);
  assert.match(submission.promptText, /如果工具返回错误，直接输出错误信息，不要继续 ask、todowrite 或 rj_set_source/);
  assert.match(submission.promptText, /单个 RJ 命中时，先调用一次 ask/);
  assert.match(submission.promptText, /source 更新为 mega/);
  assert.match(submission.promptText, /未经确认不得调用 rj_set_source/);
  assert.match(submission.promptText, /如果执行了 source 更新，在资源匹配结果后追加“来源处理结果”摘要/);
});

test("buildResourceMatchCommandPrompt 在批量 ASMROne 场景中要求批量确认与 todowrite", () => {
  const submission = buildResourceMatchCommandPrompt("asmrone", { matchAll: true });

  assert.equal(submission.displayText, "/matchASMROne -All");
  assert.match(submission.promptText, /先且只调用一次 match_asmrone_resources/);
  assert.match(submission.promptText, /批量命中时，先调用一次 ask，确认是否批量把命中 RJ 的 source 更新为 asmrone/);
  assert.match(submission.promptText, /批量流程进入多步骤处理时，再使用 todowrite/);
  assert.match(submission.promptText, /只有在用户明确确认后，才能对确认范围内的 RJ 调用 rj_set_source，并将 source 设置为 asmrone/);
});

test("getToolCallLabel 为新旧来源和状态工具返回清晰标签", () => {
  assert.equal(getToolCallLabel("rj_set_source", { rj_code: "RJ111" }), "Set RJ Source RJ111");
  assert.equal(getToolCallLabel("works_update_status", { rj_code: "RJ222" }), "Set Works Status RJ222");
  assert.equal(getToolCallLabel("match_mega_resources", { match_all: true }), "Match Mega All");
});

test("rjSetSourceSchema 暴露正确的函数名与来源枚举", () => {
  assert.equal(rjSetSourceSchema.type, "function");
  assert.equal(rjSetSourceSchema.function.name, "rj_set_source");
  assert.deepEqual(rjSetSourceSchema.function.parameters.required, ["rj_code", "source"]);
  assert.deepEqual(rjSetSourceSchema.function.parameters.properties.source.enum, ["mega", "asmrone"]);
});

test("toolsPrompt 包含资源匹配后的来源更新规范", () => {
  assert.match(toolsPrompt, /rj_set_source\(rj_code, source(?:, matched_url\?)?\)/);
  assert.match(toolsPrompt, /资源匹配成功后如需更新来源，应先通过 ask 确认，再调用此工具/);
  assert.match(toolsPrompt, /match_mega_resources\(match_all\?, rj_code\?\)/);
  assert.match(toolsPrompt, /只负责返回匹配结果，不直接修改作品来源/);
  assert.match(toolsPrompt, /资源匹配成功后，如需变更 source 为 mega，应先通过 ask 确认，再调用 rj_set_source/);
  assert.match(toolsPrompt, /资源匹配成功后，如需变更 source 为 asmrone，应先通过 ask 确认，再调用 rj_set_source/);
});
