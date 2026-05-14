import assert from "node:assert/strict";
import test from "node:test";
import { Footer } from "../src/ui/footer.ts";

const createFooter = (prompt?: string) => new Footer(() => ({
  cwd: "/Users/yonah/projects/agent/RJ-Cli",
  model: "claude-sonnet-4-6",
  contextDisplay: "12k",
  contextPercent: "34",
  prompt,
}));

test("Footer 在无 prompt 时只返回统计行", () => {
  const lines = createFooter().render(80);

  assert.equal(lines.length, 1);
});

test("Footer 在单行 prompt 时追加一行提示", () => {
  const prompt = "Removed last QA.";
  const lines = createFooter(prompt).render(80);

  assert.equal(lines.length, 2);
  assert.match(lines[1] ?? "", /Removed last QA\./);
  assert.doesNotMatch(lines[1] ?? "", /\n/);
});

test("Footer 在多行 prompt 时逐行返回且不包含裸换行符", () => {
  const prompt = "Unknown command: foobar\nType /help to see available commands.";
  const lines = createFooter(prompt).render(80);

  assert.equal(lines.length, 3);
  assert.match(lines[1] ?? "", /Unknown command: foobar/);
  assert.match(lines[2] ?? "", /Type \/help to see available commands\./);
  assert.doesNotMatch(lines[1] ?? "", /\n/);
  assert.doesNotMatch(lines[2] ?? "", /\n/);
});
