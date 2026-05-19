import assert from "node:assert/strict";
import test from "node:test";
import { SettingsSelector } from "../src/ui/settings-selector.ts";

test("SettingsSelector shows English text when no items match", () => {
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
