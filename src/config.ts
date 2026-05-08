import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RJFileReadingConfig {
  maxFileSizeBytes: number;
  maxDirectoryEntries: number;
  allowedExtensions: string[];
}

export interface RJModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  outputLimit: number;
}

export interface RJProviderConfig {
  id: string;
  name: string;
  npm?: string;
  baseURL?: string;
  apiKey?: string;
  models: RJModelConfig[];
}

export interface RJConfig {
  defaultProvider: string;
  defaultModel: string;
  fileReading: RJFileReadingConfig;
  providers: RJProviderConfig[];
  configPath: string;
}

interface RawRJConfig {
  defaultProvider?: unknown;
  defaultModel?: unknown;
  fileReading?: unknown;
  providers?: unknown;
}

const configPath = join(homedir(), ".RJ", "config.json");

const DEFAULT_FILE_READING: RJFileReadingConfig = {
  maxFileSizeBytes: 1048576,
  maxDirectoryEntries: 200,
  allowedExtensions: [],
};

const fallbackConfig: RJConfig = {
  defaultProvider: "mock",
  defaultModel: "mock-sonnet",
  fileReading: DEFAULT_FILE_READING,
  providers: [
    {
      id: "mock",
      name: "Mock",
      models: [{ id: "mock-sonnet", name: "mock-sonnet", contextWindow: 200000, outputLimit: 64000 }],
    },
  ],
  configPath,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseModel(value: unknown): RJModelConfig | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, "id");
  const name = readString(record, "name") ?? id;
  if (!id || !name) return null;
  return {
    id,
    name,
    contextWindow: readNumber(record, "contextWindow") ?? 200000,
    outputLimit: readNumber(record, "outputLimit") ?? 64000,
  };
}

function parseProvider(value: unknown): RJProviderConfig | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, "id");
  const name = readString(record, "name") ?? id;
  const rawModels = Array.isArray(record.models) ? record.models : [];
  const models = rawModels.map(parseModel).filter((model): model is RJModelConfig => Boolean(model));
  if (!id || !name || models.length === 0) return null;
  return {
    id,
    name,
    npm: readString(record, "npm"),
    baseURL: readString(record, "baseURL"),
    apiKey: readString(record, "apiKey"),
    models,
  };
}

export function loadConfig(): RJConfig {
  if (!existsSync(configPath)) return fallbackConfig;

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as RawRJConfig;
    const root = asRecord(raw);
    if (!root) return fallbackConfig;

    const providers = Array.isArray(root.providers)
      ? root.providers.map(parseProvider).filter((provider): provider is RJProviderConfig => Boolean(provider))
      : [];
    if (providers.length === 0) return fallbackConfig;

    const defaultProvider =
      readString(root, "defaultProvider") && providers.some((provider) => provider.id === readString(root, "defaultProvider"))
        ? readString(root, "defaultProvider")!
        : providers[0]!.id;
    const provider = providers.find((item) => item.id === defaultProvider) ?? providers[0]!;
    const configuredDefaultModel = readString(root, "defaultModel");
    const defaultModel =
      configuredDefaultModel && provider.models.some((model) => model.id === configuredDefaultModel)
        ? configuredDefaultModel
        : provider.models[0]!.id;

    const fileReadingRaw = asRecord(root.fileReading);
    const fileReading: RJFileReadingConfig = {
      maxFileSizeBytes: (fileReadingRaw && readNumber(fileReadingRaw, "maxFileSizeBytes")) ?? DEFAULT_FILE_READING.maxFileSizeBytes,
      maxDirectoryEntries: (fileReadingRaw && readNumber(fileReadingRaw, "maxDirectoryEntries")) ?? DEFAULT_FILE_READING.maxDirectoryEntries,
      allowedExtensions: Array.isArray(fileReadingRaw?.allowedExtensions)
        ? (fileReadingRaw.allowedExtensions as unknown[]).filter((e): e is string => typeof e === "string")
        : [],
    };

    return { defaultProvider, defaultModel, fileReading, providers, configPath };
  } catch {
    return fallbackConfig;
  }
}

export function getProvider(config: RJConfig, providerId: string): RJProviderConfig {
  return config.providers.find((provider) => provider.id === providerId) ?? config.providers[0]!;
}

export function getModel(provider: RJProviderConfig, modelId: string): RJModelConfig {
  return provider.models.find((model) => model.id === modelId) ?? provider.models[0]!;
}

export function saveDefaultModel(config: RJConfig, providerId: string, modelId: string): RJConfig {
  const provider = getProvider(config, providerId);
  const model = getModel(provider, modelId);
  const updated: RJConfig = {
    ...config,
    defaultProvider: provider.id,
    defaultModel: model.id,
  };
  const output: RawRJConfig = {
    defaultProvider: updated.defaultProvider,
    defaultModel: updated.defaultModel,
    providers: updated.providers,
  };
  mkdirSync(dirname(updated.configPath), { recursive: true });
  writeFileSync(updated.configPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return updated;
}

const promptHistoryPath = join(homedir(), ".RJ", "prompt_history.json");
const MAX_PROMPT_HISTORY = 20;

export function loadPromptHistory(): string[] {
  if (!existsSync(promptHistoryPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(promptHistoryPath, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function savePromptHistory(history: string[]): void {
  const trimmed = history.slice(-MAX_PROMPT_HISTORY);
  mkdirSync(dirname(promptHistoryPath), { recursive: true });
  writeFileSync(promptHistoryPath, `${JSON.stringify(trimmed, null, 2)}\n`, "utf8");
}

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1000000) return `${Number((tokens / 1000000).toFixed(1))}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}
