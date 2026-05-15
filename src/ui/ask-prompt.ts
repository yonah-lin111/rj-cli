import {
  Container, Input, SelectList, Spacer, Text,
  getKeybindings, matchesKey,
  type Focusable, type SelectItem,
} from "@mariozechner/pi-tui";
import type { AskQuestion } from "../tools/base/ask.ts";
import { shouldIgnoreImeIntermediate } from "../utils/input-filter.ts";
import { editorTheme, theme } from "./theme.ts";

/**
 * 提问交互组件，在 todos 下方显示。
 * - 单问题单选：直接选择即提交
 * - 单问题多选 / 多问题：左右键切换，最后一页为 confirm 确认页
 * - 双击 Esc 取消
 */
export class AskPrompt extends Container implements Focusable {
  private tabIndex = 0;
  private answers: string[][] = [];
  private customInput: Input;
  private customInputVisible = false;
  private list: SelectList;

  private headerText: Text;
  private hintText: Text;
  private questionText: Text;
  private footerText: Text;

  focused = false;

  private get needsConfirm(): boolean {
    return this.questions.length > 1 || (this.questions.length === 1 && this.questions[0]?.multiple === true);
  }

  private get isConfirmTab(): boolean {
    return this.needsConfirm && this.tabIndex === this.questions.length;
  }

  private get totalTabs(): number {
    return this.needsConfirm ? this.questions.length + 1 : 1;
  }

  constructor(
    private questions: AskQuestion[],
    private onSubmit: (answers: string[][]) => void,
    private onCancel: () => void,
  ) {
    super();

    this.headerText = new Text("", 1, 0);
    this.hintText = new Text("", 1, 0);
    this.questionText = new Text("", 1, 0);
    this.customInput = new Input();
    this.list = new SelectList([], 8, editorTheme.selectList, { minPrimaryColumnWidth: 32, maxPrimaryColumnWidth: 60 });
    this.footerText = new Text("", 1, 0);

    this.renderTab();
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    const isLeft = matchesKey(keyData, "left");
    const isRight = matchesKey(keyData, "right");

    // Esc 取消：自定义输入框激活时退出输入模式，否则直接取消
    if (kb.matches(keyData, "tui.select.cancel")) {
      if (this.customInputVisible && !this.isConfirmTab) {
        this.customInputVisible = false;
        this.rebuildChildren();
        return;
      }
      this.onCancel();
      return;
    }

    // confirm 页
    if (this.isConfirmTab) {
      if (kb.matches(keyData, "tui.select.confirm")) {
        this.onSubmit(this.answers);
        return;
      }
      if (isLeft) {
        this.tabIndex--;
        this.renderTab();
        return;
      }
      return;
    }

    const q = this.questions[this.tabIndex];
    if (!q) return;

    // 自定义输入框激活时
    if (this.customInputVisible) {
      if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
        this.customInputVisible = false;
        this.list.handleInput(keyData);
        this.rebuildChildren();
        return;
      }
      if (kb.matches(keyData, "tui.select.confirm")) {
        const text = this.customInput.getValue().trim();
        if (!text) return;
        if (q.multiple) {
          const existing = this.answers[this.tabIndex] ?? [];
          if (!existing.includes(text)) {
            this.answers[this.tabIndex] = [...existing, text];
          }
          this.customInputVisible = false;
          this.rebuildChildren();
        } else {
          this.answers[this.tabIndex] = [text];
          this.advance();
        }
        return;
      }

      if (shouldIgnoreImeIntermediate(keyData)) {
        return;
      }

      this.customInput.handleInput(keyData);
      this.rebuildChildren();
      return;
    }

    // 左右键切换（多问题或单问题多选时）
    if (this.needsConfirm) {
      if (isRight) {
        this.tabIndex = Math.min(this.totalTabs - 1, this.tabIndex + 1);
        this.renderTab();
        return;
      }
      if (isLeft) {
        this.tabIndex = Math.max(0, this.tabIndex - 1);
        this.renderTab();
        return;
      }
    }

    // 上下导航
    if (kb.matches(keyData, "tui.select.up") || kb.matches(keyData, "tui.select.down")) {
      this.list.handleInput(keyData);
      this.updateCustomInputVisibility();
      return;
    }

    // Enter 确认
    if (kb.matches(keyData, "tui.select.confirm")) {
      this.confirmCurrentSelection();
      return;
    }
  }

  invalidate(): void {
    super.invalidate();
    this.list.invalidate();
    if (this.customInputVisible) this.customInput.invalidate();
  }

  private buildItems(q: AskQuestion): SelectItem[] {
    const picked = q.multiple ? (this.answers[this.tabIndex] ?? []) : [];
    const items: SelectItem[] = q.options.map((opt) => ({
      value: opt.label,
      label: q.multiple
        ? `${picked.includes(opt.label) ? "[✓]" : "[ ]"} ${opt.label}`
        : opt.label,
      description: opt.description,
    }));
    if (q.custom !== false) {
      items.push({ value: "__custom__", label: "Type your own answer", description: "" });
    }
    return items;
  }

  private isCustomSelected(): boolean {
    return this.list.getSelectedItem()?.value === "__custom__";
  }

  private updateCustomInputVisibility(): void {
    const shouldShow = this.isCustomSelected();
    if (shouldShow !== this.customInputVisible) {
      this.customInputVisible = shouldShow;
      this.rebuildChildren();
    } else {
      this.renderFooter();
    }
  }

  private confirmCurrentSelection(): void {
    const q = this.questions[this.tabIndex];
    if (!q) return;

    const selected = this.list.getSelectedItem();
    if (!selected) return;

    if (selected.value === "__custom__") {
      this.customInputVisible = true;
      this.rebuildChildren();
      return;
    }

    const answer = selected.value;

    if (q.multiple) {
      const existing = this.answers[this.tabIndex] ?? [];
      const idx = existing.indexOf(answer);
      if (idx === -1) {
        this.answers[this.tabIndex] = [...existing, answer];
      } else {
        this.answers[this.tabIndex] = existing.filter((_, i) => i !== idx);
      }
      const currentValue = this.list.getSelectedItem()?.value;
      const items = this.buildItems(q);
      this.list = new SelectList(items, 8, editorTheme.selectList, { minPrimaryColumnWidth: 32, maxPrimaryColumnWidth: 60 });
      this.list.onCancel = undefined;
      this.list.onSelectionChange = () => this.updateCustomInputVisibility();
      if (currentValue) {
        const restoreIdx = items.findIndex((it) => it.value === currentValue);
        if (restoreIdx >= 0) this.list.setSelectedIndex(restoreIdx);
      }
      this.rebuildChildren();
      return;
    }

    this.answers[this.tabIndex] = [answer];
    this.advance();
  }

  private advance(): void {
    if (!this.needsConfirm) {
      this.onSubmit(this.answers);
      return;
    }
    this.tabIndex = Math.min(this.totalTabs - 1, this.tabIndex + 1);
    this.renderTab();
  }

  private renderTab(): void {
    this.customInput = new Input();
    this.customInputVisible = false;

    if (this.isConfirmTab) {
      this.renderConfirmTab();
      return;
    }

    const q = this.questions[this.tabIndex];
    if (!q) return;

    const multi = this.needsConfirm;
    const prefix = multi ? `[${this.tabIndex + 1}/${this.questions.length}] ` : "";
    const multiSelect = q.multiple ? theme.dim(" [Multi-select]") : "";
    this.headerText.setText(theme.askLabel(theme.bold(`${prefix}${q.header}`)) + multiSelect);
    this.questionText.setText(theme.accent(q.question));

    const items = this.buildItems(q);
    this.list = new SelectList(items, 8, editorTheme.selectList, { minPrimaryColumnWidth: 32, maxPrimaryColumnWidth: 60 });
    this.list.onCancel = undefined;
    this.list.onSelectionChange = () => this.updateCustomInputVisibility();

    const prev = this.answers[this.tabIndex];
    if (prev?.length === 1 && !q.multiple) {
      const idx = items.findIndex((it) => it.value === prev[0]);
      if (idx >= 0) this.list.setSelectedIndex(idx);
    }

    this.rebuildChildren();
  }

  private renderConfirmTab(): void {
    const allAnswered = this.questions.every((_, i) => (this.answers[i]?.length ?? 0) > 0);
    this.headerText.setText(theme.askLabel(theme.bold("Confirm")));
    this.questionText.setText(theme.accent("Review your answers and press Enter to submit."));

    const hints = ["enter submit", "← back", "esc dismiss"];
    if (!allAnswered) hints.unshift("(some questions unanswered)");
    this.hintText.setText(theme.dim(hints.join("  ")));

    this.clear();
    this.addChild(this.headerText);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(this.questionText);
    this.addChild(new Spacer(1));

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i]!;
      const ans = this.answers[i];
      const ansText = ans?.length ? ans.join(", ") : theme.error("(not answered)");
      this.addChild(new Text(`  ${theme.dim(q.header)}  ${ansText}`, 1, 0));
    }

    this.addChild(new Spacer(1));
    this.addChild(this.footerText);
    this.footerText.setText("");
  }

  private rebuildChildren(): void {
    const hints: string[] = ["↑↓ select", "enter confirm", "esc dismiss"];
    if (this.needsConfirm) {
      hints.splice(1, 0, "← → switch");
    }
    this.hintText.setText(theme.dim(hints.join("  ")));

    this.clear();
    this.addChild(this.headerText);
    this.addChild(this.hintText);
    this.addChild(new Spacer(1));
    this.addChild(this.questionText);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    if (this.customInputVisible) {
      this.addChild(new Spacer(1));
      this.addChild(this.customInput);
    }
    this.addChild(new Spacer(1));
    this.addChild(this.footerText);
    this.renderFooter();
  }

  private renderFooter(): void {
    const q = this.questions[this.tabIndex];
    if (!q || this.isConfirmTab) return;

    const parts: string[] = [];

    if (q.multiple) {
      const picked = this.answers[this.tabIndex] ?? [];
      if (picked.length > 0) {
        parts.push(theme.dim(`Selected: ${picked.join(", ")}`));
      }
    }

    if (this.customInputVisible) {
      parts.push(theme.dim("Type your answer, then press Enter"));
    }

    this.footerText.setText(parts.join("  "));
  }
}
