import {
  Container, Input, SelectList, Spacer, Text,
  getKeybindings,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import { shouldIgnoreImeIntermediate } from "../utils/input-filter.ts";
import { editorTheme, theme } from "./theme.ts";
import type { ResourceMatchSelection } from "../tools/rj-server/resource-match.ts";

const MATCH_SCOPE_ITEMS: SelectItem[] = [
  { value: "all", label: "Yes", description: "Check all pending local works" },
  { value: "single", label: "No", description: "Check one RJ code" },
];

export class ResourceMatchSelector extends Container implements Focusable {
  private scopeList: SelectList;
  private input = new Input();
  private titleText = new Text("", 1, 0);
  private hintText = new Text("", 1, 0);
  private detailText = new Text("", 1, 0);
  private errorText = new Text("", 1, 0);
  private inlineInputLabel = new Text("", 1, 0);
  private errorMessage = "";
  private lastNavTime = 0;

  focused = false;

  constructor(
    private onSelect: (selection: ResourceMatchSelection) => void,
    private onCancel: () => void,
  ) {
    super();
    this.scopeList = new SelectList(MATCH_SCOPE_ITEMS, 4, editorTheme.selectList, {
      minPrimaryColumnWidth: 16,
      maxPrimaryColumnWidth: 24,
    });
    this.scopeList.onSelectionChange = () => {
      this.clearError();
      this.renderPanel();
    };
    this.renderPanel();
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.onCancel();
      return;
    }
    if (kb.matches(keyData, "tui.select.confirm")) {
      this.submit();
      return;
    }
    if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
      const now = Date.now();
      if (now - this.lastNavTime < 120) return;
      this.lastNavTime = now;
      this.scopeList.handleInput(keyData);
      this.renderPanel();
      return;
    }

    if (this.isMatchAll()) {
      return;
    }

    if (shouldIgnoreImeIntermediate(keyData)) {
      return;
    }

    this.clearError();
    this.input.handleInput(keyData);
    this.renderPanel();
  }

  invalidate(): void {
    super.invalidate();
    this.scopeList.invalidate();
    this.input.invalidate();
  }

  private isMatchAll(): boolean {
    return this.scopeList.getSelectedItem()?.value !== "single";
  }

  private currentRjCode(): string {
    return this.input.getValue().trim();
  }

  private submit(): void {
    if (this.isMatchAll()) {
      this.onSelect({ matchAll: true });
      return;
    }
    const rjCode = this.currentRjCode();
    if (!rjCode) {
      this.errorMessage = "请输入 RJ 号";
      this.errorText.setText(theme.warning(this.errorMessage));
      this.renderPanel();
      return;
    }
    this.onSelect({ matchAll: false, rjCode });
  }

  private clearError(): void {
    this.errorMessage = "";
    this.errorText.setText("");
  }

  private renderPanel(): void {
    const matchAll = this.isMatchAll();
    const rjCode = this.currentRjCode();
    this.titleText.setText(theme.bold("Resource Match"));
    this.hintText.setText(theme.dim("↑/↓ select  Type to input when No is selected  Enter confirm  Esc cancel"));
    this.detailText.setText(theme.dim(matchAll ? "Current: All works" : `Current: Single RJ${rjCode ? ` · ${rjCode}` : ""}`));
    this.inlineInputLabel.setText(theme.askLabel(theme.bold("› Input RJ code")));

    this.clear();
    this.addChild(this.titleText);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.askLabel(theme.bold("› All works")), 1, 0));
    this.addChild(this.scopeList);

    if (!matchAll) {
      this.addChild(new Spacer(1));
      this.addChild(this.inlineInputLabel);
      this.addChild(this.input);
    }

    if (this.errorMessage) {
      this.addChild(new Spacer(1));
      this.addChild(this.errorText);
    }

    this.addChild(new Spacer(1));
    this.addChild(this.detailText);
  }
}
