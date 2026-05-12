import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RJ_DATA_DIR = join(homedir(), ".RJ");
export const DB_PATH = join(RJ_DATA_DIR, "rj.db");
export const CACHE_DIR = join(RJ_DATA_DIR, "cache");

const CREATE_RJ_TABLE = `
CREATE TABLE IF NOT EXISTS rj (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rj_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_url TEXT,
  circle TEXT,
  circle_url TEXT,
  cv TEXT,
  tags TEXT,
  is_all_ages INTEGER NOT NULL DEFAULT 0,
  release_date TEXT,
  thumbnail TEXT,
  source TEXT,
  download_links TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)
`;

const CREATE_CIRCLE_TABLE = `
CREATE TABLE IF NOT EXISTS circle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL,
  circle_url TEXT,
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)
`;

export const openDb = (readonly = false): Database.Database => {
  mkdirSync(RJ_DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH, { readonly });
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.exec(CREATE_RJ_TABLE);
    db.exec(CREATE_CIRCLE_TABLE);
  }
  return db;
};

/** tags 存为 JSON 字符串，读取时解析回数组 */
export const parseTags = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }
  return [];
};

export const serializeTags = (tags: unknown): string => JSON.stringify(parseTags(tags));

export const normalizeRjCode = (value: string): string => value.trim().toUpperCase();
