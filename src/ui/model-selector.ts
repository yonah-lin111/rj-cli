import {
  Container, Input, SelectList, Spacer, Text,
  getKeybindings,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import { formatContextWindow, type RJProviderConfig } from "../core/config.ts";
import { shouldIgnoreImeIntermediate } from "../utils/input-filter.ts";
import { editorTheme, theme } from "./theme.ts";

/** 模型选择器项，额外挂载 provider 与模型数据 */
interface ModelSelectItem extends SelectItem {
  provider: RJProviderConfig;
  model: RJProviderConfig["models"][number];
}

export class ModelSelector extends Container implements Focusable {
  private search = new Input();
  private list: SelectList;
  private details = new Text();

  focused = false;

  constructor(
    providers: RJProviderConfig[],
    currentProviderId: string,
    currentModelId: string,
    onSelect: (providerId: string, modelId: string) => void,
    onCancel: () => void,
    initialSearch = "",
  ) {
    super();

    const items: ModelSelectItem[] = providers.flatMap((provider) =>
      provider.models.map((model) => ({
        value: `${provider.name} ${model.name}`,
        label: model.name,
        description:
          `${provider.name} · ${formatContextWindow(model.contextWindow)} context · ${model.outputLimit} output` +
          `${provider.id === currentProviderId && model.id === currentModelId ? " · current" : ""}`,
        provider,
        model,
      })),
    );
    this.list = new SelectList(items, 10, editorTheme.selectList, { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 36 });

    this.search.setValue(initialSearch);
    this.search.onSubmit = () => this.selectCurrent();
    this.list.onSelect = (item) => {
      const modelItem = this.asModelItem(item);
      if (modelItem) onSelect(modelItem.provider.id, modelItem.model.id);
    };
    this.list.onCancel = onCancel;
    this.list.onSelectionChange = (item) => this.updateDetails(item);
    this.list.setSelectedIndex(
      Math.max(0, items.findIndex((item) => item.provider.id === currentProviderId && item.model.id === currentModelId)),
    );
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

  /** 将列表项收窄为带 provider 与模型数据的类型 */
  private asModelItem(item: SelectItem | null): ModelSelectItem | null {
    if (!item || !("model" in item) || !("provider" in item)) return null;
    return item as ModelSelectItem;
  }

  private updateDetails(item: SelectItem | null): void {
    const modelItem = this.asModelItem(item);
    this.details.setText(
      modelItem
        ? theme.dim(`Provider: ${modelItem.provider.name} · Model ID: ${modelItem.model.id}`)
        : theme.dim("No matching models"),
    );
  }
}
