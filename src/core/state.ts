import { formatContextWindow, getModel, getProvider, type RJConfig } from "./config.ts";

/** 应用运行时状态 */
export interface AppState {
  cwd: string;
  provider: string;
  providerName: string;
  model: string;
  contextDisplay: string;
  contextPercent: string;
  contextTokens: number;
  contextWindow: number;
  outputLimit: number;
  configPath: string;
  availableModels: string[];
  messageCount: number;
  commandCount: number;
  prompt?: string;
  startedAt: Date;
}

/**
 * 根据配置创建初始应用状态。
 */
export const createInitialState = (config: RJConfig): AppState => {
  const provider = getProvider(config, config.defaultProvider);
  const model = getModel(provider, config.defaultModel);

  return {
    cwd: process.cwd(),
    provider: provider.id,
    providerName: provider.name,
    model: model.id,
    contextDisplay: formatContextWindow(model.contextWindow),
    contextPercent: "0.0",
    contextTokens: 0,
    contextWindow: model.contextWindow,
    outputLimit: model.outputLimit,
    configPath: config.configPath,
    availableModels: provider.models.map((item) => item.id),
    messageCount: 0,
    commandCount: 0,
    startedAt: new Date(),
  };
};
