import {
  Container, SelectList, Spacer, Text,
  getKeybindings, matchesKey,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import { editorTheme, theme } from "./theme.ts";

export type WorksOutputMode = "terminal" | "page";
export type WorksQueryPreset = "latest-added" | "latest-undownloaded";

export interface WorksSelection {
  outputMode: WorksOutputMode;
  queryPreset: WorksQueryPreset;
  circleName?: string;
}

export interface WorksSelectorItem {
  name: string;
  nickname?: string | null;
  work_count?: number | null;
}

const OUTPUT_ITEMS: SelectItem[] = [
  { value: "terminal", label: "View in terminal", description: "Show local works table in terminal" },
  { value: "page", label: "Open page", description: "Open works management page" },
];

const PRESET_ITEMS: SelectItem[] = [
  { value: "latest-undownloaded", label: "Latest undownloaded", description: "Show latest 5 undownloaded works" },
  { value: "latest-added", label: "Latest added", description: "Show latest 5 added works" },
];

export class WorksSelector extends Container implements Focusable {
  private tabIndex = 0;
  private outputList: SelectList;
  private presetList: SelectList;
  private circleList: SelectList;
  private titleText = new Text("", 1, 0);
  private hintText = new Text("", 1, 0);
  private detailText = new Text("", 1, 0);
  private lastNavTime = 0;

  focused = false;

  constructor(
    private onSelect: (selection: WorksSelection) => void,
    private onCancel: () => void,
    circles: WorksSelectorItem[] = [],
  ) {
    super();
    this.outputList = new SelectList(OUTPUT_ITEMS, 6, editorTheme.selectList, { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 28 });
    this.presetList = new SelectList(PRESET_ITEMS, 8, editorTheme.selectList, { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 36 });
    this.circleList = new SelectList(this.circleItems(circles), 10, editorTheme.selectList, { minPrimaryColumnWidth: 24, maxPrimaryColumnWidth: 40 });
    this.presetList.setSelectedIndex(0);
    this.outputList.setSelectedIndex(0);
    this.circleList.setSelectedIndex(0);
    this.outputList.onSelectionChange = () => this.renderPanel();
    this.presetList.onSelectionChange = () => this.renderPanel();
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
      this.tabIndex = this.isPageMode() ? 0 : (this.tabIndex + 1) % 3;
      this.renderPanel();
      return;
    }
    if (matchesKey(keyData, "shift+tab") || keyData === "\x1b[Z") {
      this.tabIndex = this.isPageMode() ? 0 : (this.tabIndex + 2) % 3;
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
    this.presetList.invalidate();
    this.circleList.invalidate();
  }

  private activeList(): SelectList {
    if (this.tabIndex === 0) return this.outputList;
    if (this.tabIndex === 1) return this.presetList;
    return this.circleList;
  }

  private isPageMode(): boolean {
    return this.outputList.getSelectedItem()?.value === "page";
  }

  private selection(): WorksSelection {
    const outputMode = (this.outputList.getSelectedItem()?.value ?? "terminal") as WorksOutputMode;
    const queryPreset = (this.presetList.getSelectedItem()?.value ?? "latest-undownloaded") as WorksQueryPreset;
    const circleValue = this.circleList.getSelectedItem()?.value;
    return {
      outputMode,
      queryPreset,
      circleName: circleValue ? String(circleValue) : undefined,
    };
  }

  private sectionTitle(index: number, label: string): string {
    if (this.isPageMode() && index !== 0) return theme.dim(`  ${label} (disabled)`);
    return index === this.tabIndex ? theme.askLabel(theme.bold(`› ${label}`)) : theme.dim(`  ${label}`);
  }

  private circleItems(circles: WorksSelectorItem[]): SelectItem[] {
    const items: SelectItem[] = [{ value: "", label: "None", description: "Do not filter by circle" }];
    if (circles.length === 0) return items;
    return items.concat(circles.map(circle => ({
      value: circle.name,
      label: circle.name,
      description: [circle.nickname || "", `${circle.work_count ?? 0} works`].filter(Boolean).join(" · "),
    })));
  }

  private renderPanel(): void {
    const selection = this.selection();
    const pageMode = this.isPageMode();
    const outputLabel = this.outputList.getSelectedItem()?.label ?? "View in terminal";
    const presetLabel = this.presetList.getSelectedItem()?.label ?? "Latest undownloaded";
    const circleLabel = selection.circleName ?? "None";
    if (pageMode && this.tabIndex !== 0) this.tabIndex = 0;
    this.titleText.setText(theme.bold("Works"));
    this.hintText.setText(theme.dim(pageMode ? "↑/↓ select  Enter confirm  Esc cancel" : "Tab switch sections  ↑/↓ select  Enter confirm  Esc cancel"));
    this.detailText.setText(theme.dim(pageMode ? "Current: Open page" : `Current: ${outputLabel} · ${presetLabel} · ${circleLabel}`));

    this.clear();
    this.addChild(this.titleText);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.sectionTitle(0, "Output"), 1, 0));
    this.addChild(this.outputList);
    if (!pageMode) {
      this.addChild(new Spacer(1));
      this.addChild(new Text(this.sectionTitle(1, "Preset"), 1, 0));
      this.addChild(this.presetList);
      this.addChild(new Spacer(1));
      this.addChild(new Text(this.sectionTitle(2, "Circle"), 1, 0));
      this.addChild(this.circleList);
    }
    this.addChild(new Spacer(1));
    this.addChild(this.detailText);
  }
}
