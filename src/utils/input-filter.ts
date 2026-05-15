import { decodeKittyPrintable } from "@mariozechner/pi-tui";

const isNonAsciiPrintable = (value: string | undefined): boolean => {
  return Boolean(value && /[^\u0000-\u00ff]/u.test(value));
};

export const shouldIgnoreImeIntermediate = (keyData: string): boolean => {
  const kittyPrintable = decodeKittyPrintable(keyData);
  return kittyPrintable !== undefined && !isNonAsciiPrintable(kittyPrintable);
};
