import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempHome = mkdtempSync(join(tmpdir(), "rj-cli-test-home-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { openDb } = await import("../src/tools/rj-server/db.ts");
const rjServer = await import("../src/tools/rj-server/index.ts");
const resourceMatch = await import("../src/tools/rj-server/resource-match.ts");
const { rjSetSourceSchema } = await import("../src/core/ai.ts");
const { toolsPrompt } = await import("../src/prompts/tools/index.ts");

const seedRj = (downloadLinks: string | null = null) => {
  const db = openDb(false);
  db.prepare("DELETE FROM rj").run();
  db.prepare(`
    INSERT INTO rj (rj_code, title, source, download_links, status)
    VALUES (?, ?, ?, ?, ?)
  `).run("RJ123456", "Test Title", null, downloadLinks, 0);
  db.close();
};

const readRjRow = () => {
  const db = openDb(true);
  const row = db.prepare("SELECT rj_code, source, download_links FROM rj WHERE rj_code = ? LIMIT 1").get("RJ123456") as {
    rj_code: string;
    source: string | null;
    download_links: string | null;
  };
  db.close();
  return row;
};

test.after(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

test("rj_set_source 在 mega 无 matched_url 时只更新来源不覆盖 download_links", () => {
  seedRj(JSON.stringify({ mega: ["https://old.example/link"] }));
  const result = rjServer.updateRjSourceTool({ rj_code: "RJ123456", source: "mega" });
  const row = readRjRow();
  const payload = JSON.parse(result.content) as { download_links_updated: boolean };

  assert.equal(result.isError, false);
  assert.equal(row.source, "mega");
  assert.equal(row.download_links, JSON.stringify({ mega: ["https://old.example/link"] }));
  assert.equal(payload.download_links_updated, false);
});

test("rj_set_source 在 mega 带 matched_url 时写入结构化 download_links", () => {
  seedRj();
  const result = rjServer.updateRjSourceTool({ rj_code: "RJ123456", source: "mega", matched_url: "https://mega.nz/folder/abc" });
  const row = readRjRow();
  const payload = JSON.parse(result.content) as { download_links_updated: boolean; matched_url: string };

  assert.equal(result.isError, false);
  assert.equal(row.source, "mega");
  assert.deepEqual(JSON.parse(row.download_links ?? "null"), { mega: ["https://mega.nz/folder/abc"] });
  assert.equal(payload.download_links_updated, true);
  assert.equal(payload.matched_url, "https://mega.nz/folder/abc");
});

test("rj_set_source 切换到 asmrone 时清空旧 download_links", () => {
  seedRj(JSON.stringify({ mega: ["https://old.example/link"] }));
  const result = rjServer.updateRjSourceTool({ rj_code: "RJ123456", source: "asmrone" });
  const row = readRjRow();
  const payload = JSON.parse(result.content) as { download_links_updated: boolean };

  assert.equal(result.isError, false);
  assert.equal(row.source, "asmrone");
  assert.equal(row.download_links, null);
  assert.equal(payload.download_links_updated, true);
});

test("rj_set_source 在 asmrone 场景忽略 matched_url 并清空 download_links", () => {
  seedRj(JSON.stringify({ mega: ["https://old.example/link"] }));
  const result = rjServer.updateRjSourceTool({ rj_code: "RJ123456", source: "asmrone", matched_url: "https://ignored.example" });
  const row = readRjRow();

  assert.equal(result.isError, false);
  assert.equal(row.source, "asmrone");
  assert.equal(row.download_links, null);
});

test("rj_set_source 在 RJ 不存在时返回错误", () => {
  const db = openDb(false);
  db.prepare("DELETE FROM rj").run();
  db.close();

  const result = rjServer.updateRjSourceTool({ rj_code: "RJ999999", source: "mega", matched_url: "https://mega.nz/folder/missing" });

  assert.equal(result.isError, true);
  assert.match(result.content, /未找到 RJ: RJ999999/);
});

test("matchMegaResources 返回 source 与 matched_url", () => {
  seedRj();
  const result = resourceMatch.matchMegaResources({ matchAll: false, rjCode: "RJ123456" });
  const item = result.items[0];

  assert.equal(item?.source, "mega");
  if (item?.exists) {
    assert.equal(typeof item.matched_url, "string");
  } else {
    assert.equal(item?.matched_url, undefined);
  }
});

test("matchAsmroOneResources 命中包含 source 且不包含 matched_url", async () => {
  seedRj();
  const result = await resourceMatch.matchAsmroOneResources({ matchAll: false, rjCode: "RJ123456" });
  const item = result.items[0];

  assert.equal(item?.source, "asmrone");
  assert.equal(item?.matched_url, undefined);
});

test("rjSetSourceSchema 包含可选 matched_url", () => {
  assert.equal(rjSetSourceSchema.type, "function");
  assert.equal(rjSetSourceSchema.function.name, "rj_set_source");
  assert.deepEqual(rjSetSourceSchema.function.parameters.required, ["rj_code", "source"]);
  assert.equal(rjSetSourceSchema.function.parameters.properties.matched_url.type, "string");
});

test("toolsPrompt 包含来源差异与 matched_url 说明", () => {
  assert.match(toolsPrompt, /rj_set_source\(rj_code, source, matched_url\?\)/);
  assert.match(toolsPrompt, /Mega 场景可传 matched_url/);
  assert.match(toolsPrompt, /asmrone 场景会清空旧 download_links/);
  assert.match(toolsPrompt, /命中结果会结构化返回 source=mega 与 matched_url/);
  assert.match(toolsPrompt, /命中结果会结构化返回 source=asmrone，且不返回 matched_url/);
});
