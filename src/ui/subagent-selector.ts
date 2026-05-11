import {
  Container, SelectList, Spacer, Text,
  getKeybindings,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import type { SubagentSnapshot } from "./subagent-view.ts";
import { editorTheme, theme } from "./theme.ts";

/** subagent 选择器组件 */
export class SubagentSelector extends Container implements Focusable {
  private list: SelectList;
  private details = new Text();
  private items: (SelectItem & { snapshot: SubagentSnapshot })[];
  private lastNavTime = 0;

  focused = false;

  constructor(
    snapshots: SubagentSnapshot[],
    onSelect: (snapshot: SubagentSnapshot) => void,
    onCancel: () => void,
  ) {
    super();

    this.items = snapshots
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .map((snapshot) => ({
        value: snapshot.id,
        label: snapshot.title || snapshot.taskDescription,
        description: `${snapshot.agentName} · ${snapshot.status} · ${snapshot.runCount} run${snapshot.runCount === 1 ? "" : "s"} · ${formatDate(snapshot.updatedAt)}`,
        snapshot,
      }));

    this.list = new SelectList(
      this.items,
      10,
      editorTheme.selectList,
      { minPrimaryColumnWidth: 32, maxPrimaryColumnWidth: 58 },
    );

    this.list.onSelect = (item) => {
      const found = this.items.find((i) => i.value === item.value);
      if (found) onSelect(found.snapshot);
    };
    this.list.onCancel = onCancel;
    this.list.onSelectionChange = (item) => this.updateDetails(item);

    if (this.items.length > 0) this.list.setSelectedIndex(0);
    this.updateDetails(this.list.getSelectedItem());

    this.addChild(new Text(theme.bold("Select subagent"), 1, 0));
    this.addChild(new Text(theme.dim("↑/↓ move, Enter select, Esc cancel"), 1, 0));
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
    }
    this.list.handleInput(keyData);
  }

  invalidate(): void {
    super.invalidate();
    this.list.invalidate();
  }

  private updateDetails(item: SelectItem | null): void {
    if (!item) {
      this.details.setText(theme.dim("No subagents found"));
      return;
    }
    const found = this.items.find((i) => i.value === item.value);
    if (!found) return;
    const snapshot = found.snapshot;
    this.details.setText(theme.dim([
      `ID: ${snapshot.id}`,
      `Agent: ${snapshot.agentName} (${snapshot.agentId})`,
      `Task: ${snapshot.taskDescription}`,
      `Updated: ${formatDate(snapshot.updatedAt)}`,
    ].join("\n")));
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
