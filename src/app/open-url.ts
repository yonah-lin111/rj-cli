import { spawn } from "node:child_process";
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

/**
 * 使用系统默认浏览器打开本地页面。
 */
export const openUrl = async (url: string, opener: OpenUrlCommand): Promise<void> => {
  const child = process.platform === "darwin"
    ? spawn("open", [url], { detached: true, stdio: "ignore" })
    : process.platform === "win32"
      ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });

  await new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      reject(new Error(`无法调用 ${opener.label} 打开页面：${error.message}`));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
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
