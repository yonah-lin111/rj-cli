import assert from "node:assert/strict";
import test from "node:test";
import { SettingsSelector } from "../src/ui/settings-selector.ts";

test("SettingsSelector 在无匹配项时显示英文提示", () => {
  const selector = new SettingsSelector(
    [{ key: "showThinking", label: "showThinking", description: "Show assistant thinking content in chat messages" }],
    { showThinking: false },
    () => {},
    () => {},
  );

  selector.handleInput("x");
  selector.handleInput("y");
  selector.handleInput("z");

  assert.match((selector as unknown as { details: { text: string } }).details.text, /No matching settings/);
});
