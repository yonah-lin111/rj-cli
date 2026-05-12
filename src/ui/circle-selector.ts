import {
  Container, SelectList, Spacer, Text,
  getKeybindings, matchesKey,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import { editorTheme, theme } from "./theme.ts";

export type CircleOutputMode = "terminal" | "page";

export interface CircleSelection {
  outputMode: CircleOutputMode;
  circleName?: string;
}

export interface CircleSelectorItem {
  name: string;
  nickname?: string | null;
  work_count?: number | null;
}

const OUTPUT_ITEMS: SelectItem[] = [
  { value: "terminal", label: "View in terminal", description: "Show selected circle details in terminal" },
  { value: "page", label: "Open page", description: "Open circle management page" },
];

export class CircleSelector extends Container implements Focusable {
  private tabIndex = 0;
  private outputList: SelectList;
  private circleList: SelectList;
  private titleText = new Text("", 1, 0);
  private hintText = new Text("", 1, 0);
  private detailText = new Text("", 1, 0);
  private lastNavTime = 0;

  focused = false;

  constructor(
    private onSelect: (selection: CircleSelection) => void,
    private onCancel: () => void,
    circles: CircleSelectorItem[] = [],
  ) {
    super();
    this.outputList = new SelectList(OUTPUT_ITEMS, 6, editorTheme.selectList, { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 28 });
    this.circleList = new SelectList(this.circleItems(circles), 10, editorTheme.selectList, { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 40 });
    this.outputList.onSelectionChange = () => this.renderPanel();
    this.circleList.onSelectionChange = () => this.renderPanel();
    this.renderPanel();
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancel();
      return;
    }
    if (matchesKey(keyData, "tab") || keyData === "\t") {
      this.tabIndex = this.isPageMode() ? 0 : (this.tabIndex + 1) % 2;
      this.renderPanel();
      return;
    }
    if (matchesKey(keyData, "shift+tab") || keyData === "\x1b[Z") {
      this.tabIndex = this.isPageMode() ? 0 : (this.tabIndex + 1) % 2;
      this.renderPanel();
      return;
    }
    if (kb.matches(keyData, "tui.select.confirm")) {
      this.onSelect(this.selection());
      return;
    }
    if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
      const now = Date.now();
      if (now - this.lastNavTime < 120) return;
      this.lastNavTime = now;
      this.activeList().handleInput(keyData);
      this.renderPanel();
    }
  }

  invalidate(): void {
    super.invalidate();
    this.outputList.invalidate();
    this.circleList.invalidate();
  }

  private activeList(): SelectList {
    return this.tabIndex === 0 ? this.outputList : this.circleList;
  }

  private isPageMode(): boolean {
    return this.outputList.getSelectedItem()?.value === "page";
  }

  private selection(): CircleSelection {
    const outputMode = (this.outputList.getSelectedItem()?.value ?? "terminal") as CircleOutputMode;
    const circleName = this.circleList.getSelectedItem()?.value;
    return { outputMode, circleName: circleName ? String(circleName) : undefined };
  }

  private sectionTitle(index: number, label: string): string {
    if (this.isPageMode() && index !== 0) return theme.dim(`  ${label} (disabled)`);
    return index === this.tabIndex ? theme.askLabel(theme.bold(`› ${label}`)) : theme.dim(`  ${label}`);
  }

  private circleItems(circles: CircleSelectorItem[]): SelectItem[] {
    if (circles.length === 0) return [{ value: "", label: "No circles", description: "Local database has no circle records" }];
    return circles.map(circle => ({
      value: circle.name,
      label: circle.name,
      description: [circle.nickname || "", `${circle.work_count ?? 0} works`].filter(Boolean).join(" · "),
    }));
  }

  private renderPanel(): void {
    const selection = this.selection();
    const pageMode = this.isPageMode();
    const selected = this.outputList.getSelectedItem()?.label ?? "View in terminal";
    const circleName = selection.circleName ?? "No circles";
    if (pageMode && this.tabIndex !== 0) this.tabIndex = 0;
    this.titleText.setText(theme.bold("Circle"));
    this.hintText.setText(theme.dim(pageMode ? "↑/↓ select  Enter confirm  Esc cancel" : "Tab switch sections  ↑/↓ select  Enter confirm  Esc cancel"));
    this.detailText.setText(theme.dim(pageMode ? "Current: Open page" : `Current: ${selected} · ${circleName}`));

    this.clear();
    this.addChild(this.titleText);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.sectionTitle(0, "Output"), 1, 0));
    this.addChild(this.outputList);
    if (!pageMode) {
      this.addChild(new Spacer(1));
      this.addChild(new Text(this.sectionTitle(1, "Circle"), 1, 0));
      this.addChild(this.circleList);
    }
    this.addChild(new Spacer(1));
    this.addChild(this.detailText);
  }
}
