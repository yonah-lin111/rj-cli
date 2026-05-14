import assert from "node:assert/strict";
import test from "node:test";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { RJAutocompleteProvider } from "../src/utils/autocomplete.ts";
import { expandAtMentions, extractAtMentions } from "../src/tools/base/file-reader.ts";

class FakeAbortSignal extends EventTarget implements AbortSignal {
  aborted = false;
  onabort: AbortSignal["onabort"] = null;
  reason: AbortSignal["reason"] = undefined;
  throwIfAborted(): void {}
  static abort(): AbortSignal {
    return new AbortController().signal;
  }
  static timeout(): AbortSignal {
    return new AbortController().signal;
  }
  static any(): AbortSignal {
    return new AbortController().signal;
  }
}

const createOptions = () => ({ signal: new FakeAbortSignal() as AbortSignal });

test("普通单词不会误触发 @ 文件补全", async () => {
  const provider = new RJAutocompleteProvider([], process.cwd());
  const suggestions = await provider.getSuggestions(["hello"], 0, 5, createOptions());
  assert.equal(suggestions, null);
});

test("明确的 @ 路径前缀会触发文件补全", async () => {
  const provider = new RJAutocompleteProvider([], process.cwd());
  const suggestions = await provider.getSuggestions(["@src/"], 0, 5, createOptions());
  assert.ok(suggestions);
  assert.equal(suggestions?.prefix, "@src/");
  assert.ok(suggestions?.items.some((item) => item.value.startsWith("@src/")));
});

test("slash command 输入阶段优先委托内置补全", async () => {
  const provider = new RJAutocompleteProvider([{ name: "help", description: "show help" }], process.cwd());
  const suggestions = await provider.getSuggestions(["/he"], 0, 3, createOptions());
  assert.ok(suggestions);
  assert.equal(suggestions?.prefix, "/he");
  assert.ok(suggestions?.items.some((item) => item.value === "help"));
});

test("shouldTriggerFileCompletion 仅对明确 @ token 返回 true", () => {
  const provider = new RJAutocompleteProvider([], process.cwd());

  assert.equal(provider.shouldTriggerFileCompletion(["hello world"], 0, 11), false);
  assert.equal(provider.shouldTriggerFileCompletion(["/help"], 0, 5), false);
  assert.equal(provider.shouldTriggerFileCompletion(["@"], 0, 1), true);
  assert.equal(provider.shouldTriggerFileCompletion(["@src/"], 0, 5), true);
  assert.equal(provider.shouldTriggerFileCompletion(["请查看 @src/app.ts"], 0, 16), true);
});

test("applyCompletion 对非 @ 前缀委托内置补全", () => {
  const provider = new RJAutocompleteProvider([], process.cwd());
  const item: AutocompleteItem = { value: "help", label: "help", description: "show help" };
  const result = provider.applyCompletion(["/he"], 0, 3, item, "/he");
  assert.deepEqual(result.lines, ["/help "]);
  assert.equal(result.cursorCol, 6);
});

test("补全后的 @ 路径可被提交流程识别与展开", () => {
  const provider = new RJAutocompleteProvider([], process.cwd());
  const item: AutocompleteItem = { value: "@src/app.ts", label: "app.ts", description: "src/app.ts" };
  const completion = provider.applyCompletion(["请查看 @src/ap"], 0, 11, item, "@src/ap");
  assert.equal(completion.lines[0], "请查看 @src/app.ts");

  const mentions = extractAtMentions(completion.lines[0], process.cwd());
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0]?.raw, "@src/app.ts");

  const expanded = expandAtMentions(completion.lines[0], process.cwd());
  assert.match(expanded.expanded, /<file name=.*src\/app\.ts">/);
  assert.deepEqual(expanded.warnings, []);
});
