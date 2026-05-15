import {
  Container, Input, SelectList, Spacer, Text,
  getKeybindings,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import { formatContextWindow, type RJModelConfig } from "../core/config.ts";
import { shouldIgnoreImeIntermediate } from "../utils/input-filter.ts";
import { editorTheme, theme } from "./theme.ts";

export class ModelSelector extends Container implements Focusable {
  private search = new Input();
  private list: SelectList;
  private details = new Text();

  focused = false;

  constructor(
    models: RJModelConfig[],
    currentModelId: string,
    onSelect: (modelId: string) => void,
    onCancel: () => void,
    initialSearch = "",
  ) {
    super();

    const items = models.map((model) => ({
      value: model.id,
      label: model.name,
      description: `${formatContextWindow(model.contextWindow)} context · ${model.outputLimit} output${model.id === currentModelId ? " · current" : ""}`,
    }));
    this.list = new SelectList(items, 10, editorTheme.selectList, { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 36 });

    this.search.setValue(initialSearch);
    this.search.onSubmit = () => this.selectCurrent();
    this.list.onSelect = (item) => onSelect(item.value);
    this.list.onCancel = onCancel;
    this.list.onSelectionChange = (item) => this.updateDetails(item);
    this.list.setSelectedIndex(Math.max(0, items.findIndex((item) => item.value === currentModelId)));
    this.list.setFilter(initialSearch);

    this.addChild(new Text(theme.bold("Select model"), 1, 0));
    this.addChild(new Text(theme.dim("Type to filter, ↑/↓ move, Enter select, Esc cancel"), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.search);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.details);
    this.updateDetails(this.list.getSelectedItem());
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (
      kb.matches(keyData, "tui.select.up") ||
      kb.matches(keyData, "tui.select.down") ||
      kb.matches(keyData, "tui.select.confirm") ||
      kb.matches(keyData, "tui.select.cancel")
    ) {
      this.list.handleInput(keyData);
      return;
    }

    if (shouldIgnoreImeIntermediate(keyData)) {
      return;
    }

    this.search.handleInput(keyData);
    this.list.setFilter(this.search.getValue());
    this.updateDetails(this.list.getSelectedItem());
  }

  invalidate(): void {
    super.invalidate();
    this.search.invalidate();
    this.list.invalidate();
  }

  private selectCurrent(): void {
    const item = this.list.getSelectedItem();
    if (item) this.list.onSelect?.(item);
  }

  private updateDetails(item: SelectItem | null): void {
    this.details.setText(item ? theme.dim(`Model ID: ${item.value}`) : theme.dim("No matching models"));
  }
}
