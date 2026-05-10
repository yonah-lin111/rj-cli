import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** 文件读取相关配置 */
export interface RJFileReadingConfig {
  maxFileSizeBytes: number;
  maxDirectoryEntries: number;
  allowedExtensions: string[];
}

/** 单个模型配置 */
export interface RJModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  outputLimit: number;
}

/** AI 提供商配置 */
export interface RJProviderConfig {
  id: string;
  name: string;
  npm?: string;
  baseURL?: string;
  apiKey?: string;
  models: RJModelConfig[];
}

/** 单个 subagent 配置 */
export interface RJSubagentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  keybinding: string;
}

/** 应用全局配置 */
export interface RJConfig {
  defaultProvider: string;
  defaultModel: string;
  fileReading: RJFileReadingConfig;
  providers: RJProviderConfig[];
  subagents: RJSubagentConfig[];
  configPath: string;
}

/** 原始配置文件结构（字段类型未验证） */
interface RawRJConfig {
  defaultProvider?: unknown;
  defaultModel?: unknown;
  fileReading?: unknown;
  providers?: unknown;
  subagents?: unknown;
}

/** 配置文件路径 */
const configPath = join(homedir(), ".RJ", "config.json");

/** 文件读取默认配置 */
const DEFAULT_FILE_READING: RJFileReadingConfig = {
  maxFileSizeBytes: 1048576,
  maxDirectoryEntries: 200,
  allowedExtensions: [],
};

/** 内置 explore subagent 默认配置 */
const DEFAULT_EXPLORE_AGENT: RJSubagentConfig = {
  id: "explore",
  name: "Explore",
  description: "多文件探索 agent，专门用于读取和分析文件内容",
  systemPrompt:
    "You are a file exploration assistant. Your job is to read and analyze files as requested by the user. " +
    "Use the read_file tool to read files. Provide clear, concise summaries of what you find. " +
    "When exploring multiple files, organize your findings logically.",
  keybinding: "ctrl+e",
};

/** 配置文件缺失或解析失败时的兜底配置 */
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
  subagents: [DEFAULT_EXPLORE_AGENT],
  configPath,
};

/**
 * 解析单个 subagent 配置，字段不合法返回 null。
 */
const parseSubagent = (value: unknown): RJSubagentConfig | null => {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record, "id");
  const name = readString(record, "name") ?? id;
  const description = readString(record, "description") ?? "";
  const systemPrompt = readString(record, "systemPrompt") ?? "";
  const keybinding = readString(record, "keybinding") ?? "";
  if (!id || !name || !keybinding) return null;
  return { id, name, description, systemPrompt, keybinding };
};

/**
 * 将 unknown 值转为 Record，非对象或数组返回 null。
 */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * 从 Record 中读取非空字符串字段，不满足则返回 undefined。
 */
const readString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

/**
 * 从 Record 中读取有限数字字段，不满足则返回 undefined。
 */
const readNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/**
 * 解析单个模型配置，字段不合法返回 null。
 */
const parseModel = (value: unknown): RJModelConfig | null => {
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
};

/**
 * 解析单个提供商配置，字段不合法或无有效模型返回 null。
 */
const parseProvider = (value: unknown): RJProviderConfig | null => {
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
};

/**
 * 从 ~/.RJ/config.json 加载配置，文件不存在或解析失败时返回兜底配置。
 */
export const loadConfig = (): RJConfig => {
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

    const parsedSubagents = Array.isArray(root.subagents)
      ? root.subagents.map(parseSubagent).filter((s): s is RJSubagentConfig => Boolean(s))
      : [];
    const subagents = parsedSubagents.length > 0 ? parsedSubagents : [DEFAULT_EXPLORE_AGENT];

    return { defaultProvider, defaultModel, fileReading, providers, subagents, configPath };
  } catch {
    return fallbackConfig;
  }
};

/**
 * 按 id 查找提供商，找不到则返回第一个。
 */
export const getProvider = (config: RJConfig, providerId: string): RJProviderConfig =>
  config.providers.find((provider) => provider.id === providerId) ?? config.providers[0]!;

/**
 * 按 id 查找模型，找不到则返回第一个。
 */
export const getModel = (provider: RJProviderConfig, modelId: string): RJModelConfig =>
  provider.models.find((model) => model.id === modelId) ?? provider.models[0]!;

/**
 * 将指定提供商和模型设为默认，并持久化到配置文件。
 */
export const saveDefaultModel = (config: RJConfig, providerId: string, modelId: string): RJConfig => {
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
    subagents: updated.subagents,
  };
  mkdirSync(dirname(updated.configPath), { recursive: true });
  writeFileSync(updated.configPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return updated;
};

/** 提示历史文件路径 */
const promptHistoryPath = join(homedir(), ".RJ", "prompt_history.json");

/** 最多保留的提示历史条数 */
const MAX_PROMPT_HISTORY = 20;

/**
 * 从文件加载提示历史，文件不存在或解析失败返回空数组。
 */
export const loadPromptHistory = (): string[] => {
  if (!existsSync(promptHistoryPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(promptHistoryPath, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
};

/**
 * 将提示历史持久化到文件，超出上限时截断旧记录。
 */
export const savePromptHistory = (history: string[]): void => {
  const trimmed = history.slice(-MAX_PROMPT_HISTORY);
  mkdirSync(dirname(promptHistoryPath), { recursive: true });
  writeFileSync(promptHistoryPath, `${JSON.stringify(trimmed, null, 2)}\n`, "utf8");
};

/**
 * 将 token 数格式化为可读字符串（如 200k、1.5M）。
 */
export const formatContextWindow = (tokens: number): string => {
  if (tokens >= 1000000) return `${Number((tokens / 1000000).toFixed(1))}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
};
