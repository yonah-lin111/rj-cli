import {
  Container, Input, SelectList, Spacer, Text,
  getKeybindings,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import type { RJSettingsConfig } from "../core/config.ts";
import { shouldIgnoreImeIntermediate } from "../utils/input-filter.ts";
import { editorTheme, theme } from "./theme.ts";

/** 设置项定义 */
export interface SettingDefinition {
  key: keyof RJSettingsConfig;
  label: string;
  description: string;
}

/** 设置选择器返回值 */
export interface SettingsSelection {
  settings: RJSettingsConfig;
  changed: boolean;
}

/** 带设置元数据的列表项 */
interface SettingSelectItem extends SelectItem {
  settingKey: keyof RJSettingsConfig;
}

/** 设置面板，支持搜索与切换 */
export class SettingsSelector extends Container implements Focusable {
  private search = new Input();
  private list: SelectList;
  private details = new Text();
  private draftSettings: RJSettingsConfig;
  private originalSettings: RJSettingsConfig;
  private items: SettingSelectItem[];
  private lastNavTime = 0;

  focused = false;

  constructor(
    definitions: SettingDefinition[],
    currentSettings: RJSettingsConfig,
    onConfirm: (selection: SettingsSelection) => void,
    onCancel: () => void,
  ) {
    super();

    this.originalSettings = { ...currentSettings };
    this.draftSettings = { ...currentSettings };
    this.onConfirm = onConfirm;
    this.items = definitions.map((definition) => this.toItem(definition));
    this.list = new SelectList(
      this.items,
      10,
      editorTheme.selectList,
      { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 40 },
    );

    this.search.onSubmit = () => this.emitConfirm();
    this.list.onCancel = () => this.emitConfirm();
    this.list.onSelectionChange = (item) => {
      this.syncLabels();
      this.updateDetails(item);
    };

    if (this.items.length > 0) this.list.setSelectedIndex(0);

    this.addChild(new Text(theme.bold("Settings"), 1, 0));
    this.addChild(new Text(theme.dim("Type to filter, ↑/↓ move, Space toggle, Enter/Esc save and close"), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.search);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.details);

    this.syncLabels();
    this.updateDetails(this.list.getSelectedItem());
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();

    if (kb.matches(keyData, "tui.select.cancel") || kb.matches(keyData, "tui.select.confirm")) {
      this.emitConfirm();
      return;
    }

    const isNav = kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down");
    if (isNav) {
      const now = Date.now();
      if (now - this.lastNavTime < 120) return;
      this.lastNavTime = now;
      this.list.handleInput(keyData);
      return;
    }

    if (keyData === " ") {
      this.toggleCurrent();
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

  private emitConfirm(): void {
    this.onConfirm({
      settings: { ...this.draftSettings },
      changed: this.hasChanges(),
    });
  }

  private readonly onConfirm: (selection: SettingsSelection) => void;

  private toItem(definition: SettingDefinition): SettingSelectItem {
    return {
      value: definition.key,
      label: definition.label,
      description: this.settingValueText(definition.key),
      settingKey: definition.key,
    };
  }

  private settingValueText(key: keyof RJSettingsConfig): string {
    return `${this.draftSettings[key] ? "true" : "false"}${this.originalSettings[key] !== this.draftSettings[key] ? " · modified" : ""}`;
  }

  private toggleCurrent(): void {
    const item = this.asSettingItem(this.list.getSelectedItem());
    if (!item) return;
    this.draftSettings[item.settingKey] = !this.draftSettings[item.settingKey];
    this.syncLabels();
    this.updateDetails(item);
  }

  private syncLabels(): void {
    for (const item of this.items) {
      item.description = this.settingValueText(item.settingKey);
    }
  }

  private hasChanges(): boolean {
    return this.originalSettings.showThinking !== this.draftSettings.showThinking;
  }

  private asSettingItem(item: SelectItem | null): SettingSelectItem | null {
    if (!item || !("settingKey" in item)) return null;
    return item as SettingSelectItem;
  }

  private updateDetails(item: SelectItem | null): void {
    const settingItem = this.asSettingItem(item);
    if (!settingItem) {
      this.details.setText(theme.dim("No matching settings"));
      return;
    }
    const value = this.draftSettings[settingItem.settingKey] ? "true" : "false";
    this.details.setText(theme.dim(`${settingItem.label}: ${value} · Space toggle, Enter/Esc save and close`));
  }
}
