import assert from "node:assert/strict";
import test from "node:test";
import type { ChatHistoryMessage } from "../src/core/ai.ts";
import type { Message } from "../src/ui/messages.ts";
import { extractLastQARjInfo, findLastQAPair, findLastSessionQARange, trimLastSessionQA } from "../src/app/message-history.ts";

/** 构造测试用 tool 历史消息 */
const createToolMessage = (toolName: string, payload: unknown, isError = false): ChatHistoryMessage => ({
  role: "tool",
  tool_call_id: `${toolName}-1`,
  toolName,
  content: JSON.stringify(payload),
  isError,
});

test("findLastQAPair 支持命令类型作为可撤销的 QA 起点", () => {
  const messages: Message[] = [
    { kind: "user", text: "普通提问", label: "user" },
    { kind: "assistant", text: "普通回答", label: "RJ" },
    { kind: "command", text: "/info", label: "qa" },
    { kind: "assistant", text: "上一轮 QA 的 RJ 详情：\nRJ123456", label: "RJ" },
  ];

  assert.deepEqual(findLastQAPair(messages), { userIndex: 2, assistantIndex: 3 });
});

test("trimLastSessionQA 会移除最后一轮命令型 QA 及其后续内容", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
    { role: "user", content: "/info" },
    { role: "assistant", content: "上一轮 QA 的 RJ 详情：\nRJ123456" },
    { role: "system", content: "后续系统提示" },
  ];

  trimLastSessionQA(messages);

  assert.deepEqual(messages, [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
  ]);
});

test("findLastSessionQARange 返回最后一轮已完成 QA 范围", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "先问上一题" },
    { role: "assistant", content: "先答上一题" },
    { role: "user", content: "请查看 RJ123456" },
    { role: "assistant", content: "好的，处理中" },
  ];

  assert.deepEqual(findLastSessionQARange(messages), { userIndex: 2, assistantIndex: 3 });
});

test("trimLastSessionQA 会移除最后一轮 QA 及其后续内容", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "system", content: "system" },
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
    { role: "user", content: "第二问 RJ123456" },
    createToolMessage("rj_get_detail", { rj_code: "RJ123456", title: "标题" }),
    { role: "assistant", content: "第二答" },
  ];

  trimLastSessionQA(messages);

  assert.deepEqual(messages, [
    { role: "system", content: "system" },
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
  ]);
});

test("extractLastQARjInfo 提取单条详情并过滤所有 URL 字段", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "请查看 RJ123456" },
    createToolMessage("rj_get_detail", {
      rj_code: "RJ123456",
      title: "作品标题",
      circle: "社团A",
      cv: "CVA",
      tags: ["治愈", "耳骚"],
      source: "mega",
      status: 2,
      release_date: "2024-01-01",
      is_all_ages: true,
      download_links: { mega: ["https://mega.nz/test"] },
      matched_url: "https://mega.nz/folder/abc",
      title_url: "https://example.com/title",
      circle_url: "https://example.com/circle",
      thumbnail: "https://example.com/thumb.jpg",
    }),
    { role: "assistant", content: "已找到 RJ123456 的信息。" },
  ];

  assert.deepEqual(extractLastQARjInfo(messages), {
    range: { userIndex: 0, assistantIndex: 2 },
    items: [{
      rj_code: "RJ123456",
      title: "作品标题",
      circle: "社团A",
      cv: "CVA",
      tags: ["治愈", "耳骚"],
      source: "mega",
      status: 2,
      release_date: "2024-01-01",
      is_all_ages: true,
    }],
    textOnlyCodes: [],
    matchedSources: [],
  });
});

test("extractLastQARjInfo 支持 rj_query 多条结果并按 rj_code 去重合并", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "查询 RJ123456 和 RJ234567" },
    createToolMessage("rj_query", {
      total: 2,
      page: 1,
      page_size: 20,
      data: [
        { rj_code: "RJ234567", title: "标题B", source: "asmrone" },
        { rj_code: "RJ123456", title: "标题A", circle: "社团A" },
      ],
    }),
    createToolMessage("rj_get_detail", {
      rj_code: "RJ123456",
      title: "标题A-更新",
      circle: "社团A",
      cv: "CV-A",
      matched_url: "https://example.com/ignore",
    }),
    { role: "assistant", content: "查到了 RJ234567 与 RJ123456。" },
  ];

  assert.deepEqual(extractLastQARjInfo(messages), {
    range: { userIndex: 0, assistantIndex: 3 },
    items: [
      {
        rj_code: "RJ123456",
        title: "标题A-更新",
        circle: "社团A",
        cv: "CV-A",
        tags: undefined,
        source: undefined,
        status: undefined,
        release_date: undefined,
        is_all_ages: undefined,
      },
      {
        rj_code: "RJ234567",
        title: "标题B",
        circle: undefined,
        cv: undefined,
        tags: undefined,
        source: "asmrone",
        status: undefined,
        release_date: undefined,
        is_all_ages: undefined,
      },
    ],
    textOnlyCodes: [],
    matchedSources: [],
  });
});

test("extractLastQARjInfo 兼容 assistant blocks 文本并收集仅文本提到的编号", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "顺便看看 rj345678" },
    { role: "assistant", blocks: [{ type: "thinking", thinking: "思考中" }, { type: "text", text: "文本里提到 RJ456789。" }] },
  ];

  assert.deepEqual(extractLastQARjInfo(messages), {
    range: { userIndex: 0, assistantIndex: 1 },
    items: [],
    textOnlyCodes: ["RJ345678", "RJ456789"],
    matchedSources: [],
  });
});

test("extractLastQARjInfo 仅把资源匹配结果作为补充来源信息且不暴露 matched_url", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "检查 RJ123456 和 RJ234567 资源" },
    createToolMessage("match_mega_resources", {
      items: [
        { rj_code: "RJ123456", source: "mega", exists: true, matched_url: "https://mega.nz/folder/abc" },
        { rj_code: "RJ234567", source: "mega", exists: false, matched_url: "https://mega.nz/folder/missing" },
      ],
    }),
    createToolMessage("rj_get_detail", {
      rj_code: "RJ123456",
      title: "标题A",
    }),
    { role: "assistant", content: "资源检查完成。" },
  ];

  assert.deepEqual(extractLastQARjInfo(messages), {
    range: { userIndex: 0, assistantIndex: 3 },
    items: [{
      rj_code: "RJ123456",
      title: "标题A",
      circle: undefined,
      cv: undefined,
      tags: undefined,
      source: undefined,
      status: undefined,
      release_date: undefined,
      is_all_ages: undefined,
    }],
    textOnlyCodes: ["RJ234567"],
    matchedSources: [
      { rj_code: "RJ123456", source: "mega", status: "matched" },
    ],
  });
});

test("extractLastQARjInfo 在无 RJ 信息时返回空结果", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "你好" },
    createToolMessage("rj_get_detail", { foo: "bar" }, true),
    { role: "assistant", content: "这里没有编号。" },
  ];

  assert.deepEqual(extractLastQARjInfo(messages), {
    range: { userIndex: 0, assistantIndex: 2 },
    items: [],
    textOnlyCodes: [],
    matchedSources: [],
  });
});

test("extractLastQARjInfo 在最后一轮 QA 未完成时返回无范围结果", () => {
  const messages: ChatHistoryMessage[] = [
    { role: "user", content: "看看 RJ123456" },
    createToolMessage("rj_get_detail", { rj_code: "RJ123456", title: "标题A" }),
  ];

  assert.deepEqual(extractLastQARjInfo(messages), {
    items: [],
    textOnlyCodes: [],
    matchedSources: [],
  });
});
