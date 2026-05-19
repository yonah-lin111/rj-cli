import assert from "node:assert/strict";
import test from "node:test";
import { executeSlashCommand, getCommands, type AppCommandContext } from "../src/core/commands.ts";

const commandContext: AppCommandContext = {
  cwd: "/tmp",
  provider: "test-provider",
  providerName: "Test Provider",
  model: "test-model",
  contextDisplay: "0%",
  contextPercent: "0%",
  contextTokens: 0,
  outputLimit: 0,
  configPath: "/tmp/config.json",
  availableModels: [],
  messageCount: 0,
  commandCount: 0,
  startedAt: new Date("2026-05-19T00:00:00.000Z"),
};

test("/setting command description uses English text", () => {
  const command = getCommands().find((item) => item.name === "/setting");

  assert.ok(command);
  assert.equal(command?.description, "Open the settings selector.");
});

test("/matchMega 无参数时仅填充输入框", () => {
  const action = executeSlashCommand("/matchMega", commandContext);

  assert.deepEqual(action, {
    type: "fill-input",
    text: "/matchMega []",
    cursorCol: "/matchMega [".length,
  });
});

test("/matchMega [] 时执行全量匹配", () => {
  const action = executeSlashCommand("/matchMega []", commandContext);

  assert.equal(action.type, "command-chat");
  if (action.type === "command-chat") {
    assert.equal(action.displayText, "/matchMega []");
    assert.match(action.promptText, /\{"match_all":true\}/);
  }
});

test("/matchMega [RJ123456] 时执行单个匹配", () => {
  const action = executeSlashCommand("/matchMega [RJ123456]", commandContext);

  assert.equal(action.type, "command-chat");
  if (action.type === "command-chat") {
    assert.equal(action.displayText, "/matchMega [RJ123456]");
    assert.match(action.promptText, /\{"match_all":false,"rj_code":"RJ123456"\}/);
  }
});

test("/matchMega [abc123] 时直接提示 RJ 前缀错误", () => {
  const action = executeSlashCommand("/matchMega [abc123]", commandContext);

  assert.deepEqual(action, {
    type: "messages",
    messages: ["RJ code must start with RJ, for example /matchMega [RJ123456]"],
  });
});

test("/matchMega RJ123456 时直接提示方括号格式错误", () => {
  const action = executeSlashCommand("/matchMega RJ123456", commandContext);

  assert.deepEqual(action, {
    type: "messages",
    messages: ["RJ code must be enclosed in brackets and start with RJ, for example /matchMega [RJ123456]"],
  });
});

test("/matchASMROne 无参数时仅填充输入框", () => {
  const action = executeSlashCommand("/matchASMROne", commandContext);

  assert.deepEqual(action, {
    type: "fill-input",
    text: "/matchASMROne []",
    cursorCol: "/matchASMROne [".length,
  });
});

test("/matchASMROne [] 时执行全量匹配", () => {
  const action = executeSlashCommand("/matchASMROne []", commandContext);

  assert.equal(action.type, "command-chat");
  if (action.type === "command-chat") {
    assert.equal(action.displayText, "/matchASMROne []");
    assert.match(action.promptText, /\{"match_all":true\}/);
  }
});

test("/matchASMROne [RJ123456] 时执行单个匹配", () => {
  const action = executeSlashCommand("/matchASMROne [RJ123456]", commandContext);

  assert.equal(action.type, "command-chat");
  if (action.type === "command-chat") {
    assert.equal(action.displayText, "/matchASMROne [RJ123456]");
    assert.match(action.promptText, /\{"match_all":false,"rj_code":"RJ123456"\}/);
  }
});

test("/matchASMROne [abc123] 时直接提示 RJ 前缀错误", () => {
  const action = executeSlashCommand("/matchASMROne [abc123]", commandContext);

  assert.deepEqual(action, {
    type: "messages",
    messages: ["RJ code must start with RJ, for example /matchASMROne [RJ123456]"],
  });
});

test("/matchASMROne RJ123456 时直接提示方括号格式错误", () => {
  const action = executeSlashCommand("/matchASMROne RJ123456", commandContext);

  assert.deepEqual(action, {
    type: "messages",
    messages: ["RJ code must be enclosed in brackets and start with RJ, for example /matchASMROne [RJ123456]"],
  });
});
