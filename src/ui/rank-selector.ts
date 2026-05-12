import {
  Container, SelectList, Spacer, Text,
  getKeybindings, matchesKey,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import type { RankingType } from "../tools/rj-server/scraper.ts";
import { editorTheme, theme } from "./theme.ts";

export interface RankSelection {
  rankingType: RankingType;
  pageSize: number;
  openPage: boolean;
}

const PERIOD_ITEMS: SelectItem[] = [
  { value: "24h", label: "Day", description: "24-hour ranking" },
  { value: "7d", label: "Week", description: "7-day ranking" },
  { value: "30d", label: "Month", description: "30-day ranking" },
  { value: "year", label: "Year", description: "Yearly ranking" },
];

const EXPORT_ITEMS: SelectItem[] = [
  { value: "view", label: "View only", description: "Show ranking table in terminal" },
  { value: "page", label: "Open page", description: "Open a paginated and searchable ranking page" },
];

const countItems = (): SelectItem[] => Array.from({ length: 6 }, (_, index) => {
  const count = (index + 1) * 5;
  return { value: String(count), label: `${count} rows`, description: count === 30 ? "Max 30 rows" : "" };
});

export class RankSelector extends Container implements Focusable {
  private tabIndex = 0;
  private periodList: SelectList;
  private countList: SelectList;
  private exportList: SelectList;
  private titleText = new Text("", 1, 0);
  private hintText = new Text("", 1, 0);
  private detailText = new Text("", 1, 0);
  private lastNavTime = 0;

  focused = false;

  constructor(
    private onSelect: (selection: RankSelection) => void,
    private onCancel: () => void,
  ) {
    super();
    this.periodList = new SelectList(PERIOD_ITEMS, 6, editorTheme.selectList, { minPrimaryColumnWidth: 16, maxPrimaryColumnWidth: 24 });
    this.countList = new SelectList(countItems(), 8, editorTheme.selectList, { minPrimaryColumnWidth: 16, maxPrimaryColumnWidth: 24 });
    this.exportList = new SelectList(EXPORT_ITEMS, 6, editorTheme.selectList, { minPrimaryColumnWidth: 18, maxPrimaryColumnWidth: 28 });
    this.countList.setSelectedIndex(1);
    this.periodList.onSelectionChange = () => this.renderPanel();
    this.countList.onSelectionChange = () => this.renderPanel();
    this.exportList.onSelectionChange = () => this.renderPanel();
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
    this.periodList.invalidate();
    this.countList.invalidate();
    this.exportList.invalidate();
  }

  private activeList(): SelectList {
    if (this.tabIndex === 0) return this.exportList;
    if (this.tabIndex === 1) return this.periodList;
    return this.countList;
  }

  private isPageMode(): boolean {
    return this.exportList.getSelectedItem()?.value === "page";
  }

  private selection(): RankSelection {
    const rankingType = (this.periodList.getSelectedItem()?.value ?? "24h") as RankingType;
    const pageSize = Math.min(30, Math.max(5, Number(this.countList.getSelectedItem()?.value ?? 10)));
    return {
      rankingType,
      pageSize,
      openPage: this.isPageMode(),
    };
  }

  private sectionTitle(index: number, label: string): string {
    if (this.isPageMode() && index !== 0) return theme.dim(`  ${label} (disabled)`);
    return index === this.tabIndex ? theme.askLabel(theme.bold(`› ${label}`)) : theme.dim(`  ${label}`);
  }

  private renderPanel(): void {
    const selection = this.selection();
    const periodLabel = this.periodList.getSelectedItem()?.label ?? "Day";
    const pageMode = selection.openPage;
    if (pageMode && this.tabIndex !== 0) this.tabIndex = 0;
    this.titleText.setText(theme.bold("RJ Ranking"));
    this.hintText.setText(theme.dim(pageMode ? "↑/↓ select page mode  Enter confirm  Esc cancel" : "Tab switch sections  ↑/↓ select  Enter confirm  Esc cancel"));
    this.detailText.setText(theme.dim(pageMode ? "Current: Open page" : `Current: ${periodLabel} · ${selection.pageSize} rows · View only`));

    this.clear();
    this.addChild(this.titleText);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.sectionTitle(0, "Output"), 1, 0));
    this.addChild(this.exportList);
    if (!pageMode) {
      this.addChild(new Spacer(1));
      this.addChild(new Text(this.sectionTitle(1, "Period"), 1, 0));
      this.addChild(this.periodList);
      this.addChild(new Spacer(1));
      this.addChild(new Text(this.sectionTitle(2, "Rows"), 1, 0));
      this.addChild(this.countList);
    }
    this.addChild(new Spacer(1));
    this.addChild(this.detailText);
  }
}
