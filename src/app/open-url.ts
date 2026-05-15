import { type AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startRankPageServer } from "./rank-page.ts";

export type OpenUrlCommand = {
  command: string;
  label: string;
};

export const detectOpenUrlCommand = (): OpenUrlCommand => {
  if (process.platform === "darwin") {
    return { command: "open", label: "open" };
  }
  if (process.platform === "win32") {
    return { command: "start", label: "start" };
  }
  return { command: "xdg-open", label: "xdg-open" };
};

export const ensureRankPageServer = async (server?: Server): Promise<Server> =>
  server?.listening ? server : await startRankPageServer();

export const buildRankPageUrl = (address: AddressInfo, rankingType: string, pageSize: number): string =>
  `http://127.0.0.1:${address.port}/rank?ranking_type=${encodeURIComponent(rankingType)}&page_size=${pageSize}`;

export const buildCirclePageUrl = (address: AddressInfo): string =>
  `http://127.0.0.1:${address.port}/circle?page_size=30`;

export const buildWorksPageUrl = (
  address: AddressInfo,
  queryPreset: "all" | "latest-added" | "latest-undownloaded",
  circleName?: string,
): string => {
  const params = new URLSearchParams({ page_size: "30" });
  if (queryPreset !== "all") params.set("preset", queryPreset);
  if (circleName) params.set("circle", circleName);
  return `http://127.0.0.1:${address.port}/works?${params.toString()}`;
};
