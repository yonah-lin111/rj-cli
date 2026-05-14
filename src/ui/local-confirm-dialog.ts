import type { AskQuestion } from "../tools/base/ask.ts";

export interface LocalConfirmDialogConfig {
  header: string;
  question: string;
  confirmLabel: string;
  confirmDescription: string;
  cancelLabel?: string;
  cancelDescription: string;
}

export const buildLocalConfirmQuestion = (
  config: LocalConfirmDialogConfig,
): AskQuestion[] => [{
  header: config.header,
  question: config.question,
  options: [
    {
      label: config.confirmLabel,
      description: config.confirmDescription,
    },
    {
      label: config.cancelLabel ?? "Cancel",
      description: config.cancelDescription,
    },
  ],
  custom: false,
}];
