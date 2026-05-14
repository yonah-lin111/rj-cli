import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("目录 @ 路径优先使用 bash 列出目录内容", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "rj-file-reader-"));
  const dirPath = join(tempRoot, "docs");
  try {
    mkdirSync(dirPath);
    writeFileSync(join(dirPath, "a.txt"), "hello");
    mkdirSync(join(dirPath, "nested"));

    const lsOutput = execFileSync("/bin/ls", ["-1Ap", dirPath], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const expanded = expandAtMentions(`请查看 @${dirPath}`, process.cwd());

    assert.match(expanded.expanded, new RegExp(`<file name="${dirPath}" type="directory">`));
    assert.deepEqual(expanded.warnings, []);
    for (const line of lsOutput) {
      assert.match(expanded.expanded, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("目录 @ 路径在 bash 结果中会展开为目录列表而不是报错", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "rj-file-reader-"));
  const dirPath = join(tempRoot, "docs");
  try {
    mkdirSync(dirPath);
    writeFileSync(join(dirPath, "a.txt"), "hello");
    mkdirSync(join(dirPath, "nested"));

    const expanded = expandAtMentions(`请查看 @${dirPath}`, process.cwd());
    assert.match(expanded.expanded, new RegExp(`<file name="${dirPath}" type="directory">`));
    assert.match(expanded.expanded, /nested\//);
    assert.match(expanded.expanded, /a\.txt/);
    assert.deepEqual(expanded.warnings, []);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
