import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR } from "./db.ts";

const DEFAULT_EXPIRE_SECS = 86400; // 1天

interface CachePayload {
  key: string;
  expires_at: number | null;
  data: unknown;
}

const cacheFile = (cacheKey: string): string => {
  const digest = createHash("sha256").update(cacheKey, "utf8").digest("hex");
  return join(CACHE_DIR, `${digest}.json`);
};

export const cacheGet = (cacheKey: string): unknown | null => {
  const file = cacheFile(cacheKey);
  if (!existsSync(file)) return null;
  try {
    const payload = JSON.parse(readFileSync(file, "utf8")) as CachePayload;
    if (payload.expires_at !== null && payload.expires_at <= Date.now() / 1000) return null;
    return payload.data ?? null;
  } catch {
    return null;
  }
};

export const cacheSet = (cacheKey: string, data: unknown, expireSecs = DEFAULT_EXPIRE_SECS): void => {
  mkdirSync(CACHE_DIR, { recursive: true });
  const payload: CachePayload = {
    key: cacheKey,
    expires_at: expireSecs > 0 ? Date.now() / 1000 + expireSecs : null,
    data,
  };
  writeFileSync(cacheFile(cacheKey), JSON.stringify(payload, null, 0), "utf8");
};

export const rankingCacheKey = (rankingType: string): string =>
  `dlsite:ranking:${rankingType}:pages:1`;
