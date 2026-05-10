import {
  Container, Input, SelectList, Spacer, Text,
  getKeybindings,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import type { SessionRecord } from "../core/session.ts";
import { editorTheme, theme } from "./theme.ts";

/** 会话选择器组件，参考 ModelSelector 实现 */
export class SessionSelector extends Container implements Focusable {
  private search = new Input();
  private list: SelectList;
  private details = new Text();
  private items: (SelectItem & { session: SessionRecord })[];
  private lastNavTime = 0;

  focused = false;

  constructor(
    sessions: SessionRecord[],
    onSelect: (session: SessionRecord) => void,
    onCancel: () => void,
  ) {
    super();

    this.items = sessions.map((s) => ({
      value: s.id,
      label: s.title,
      description: formatDate(s.updatedAt),
      session: s,
    }));

    this.list = new SelectList(
      this.items,
      10,
      editorTheme.selectList,
      { minPrimaryColumnWidth: 32, maxPrimaryColumnWidth: 48 },
    );

    this.search.onSubmit = () => this.selectCurrent();
    this.list.onSelect = (item) => {
      const found = this.items.find((i) => i.value === item.value);
      if (found) onSelect(found.session);
    };
    this.list.onCancel = onCancel;
    this.list.onSelectionChange = (item) => this.updateDetails(item);

    if (this.items.length > 0) this.list.setSelectedIndex(0);
    this.updateDetails(this.list.getSelectedItem());

    this.addChild(new Text(theme.bold("Select session"), 1, 0));
    this.addChild(new Text(theme.dim("Type to filter, ↑/↓ move, Enter select, Esc cancel"), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.search);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(this.details);
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    const isNav = kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down");
    if (isNav) {
      const now = Date.now();
      if (now - this.lastNavTime < 120) return;
      this.lastNavTime = now;
      this.list.handleInput(keyData);
      return;
    }
    if (
      kb.matches(keyData, "tui.select.confirm") ||
      kb.matches(keyData, "tui.select.cancel")
    ) {
      this.list.handleInput(keyData);
      return;
    }
    this.search.handleInput(keyData);
    const filter = this.search.getValue().toLowerCase();
    const filtered = filter
      ? this.items.filter((i) => i.label!.toLowerCase().includes(filter))
      : this.items;
    // SelectList.setFilter 按 value 过滤，这里需要按 label(title) 过滤，直接设置 filteredItems
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.list as any).filteredItems = filtered;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.list as any).selectedIndex = 0;
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
    this.details.setText(
      item ? theme.dim(`Session ID: ${item.value}`) : theme.dim("No sessions found"),
    );
  }
}

/** 将 ISO 时间字符串格式化为可读形式 */
const formatDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
};
