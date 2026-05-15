# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

- Install dependencies: `pnpm install`
- Start the CLI in development mode: `pnpm dev`
- Type-check the TypeScript CLI: `pnpm typecheck`
- Run all root tests: `pnpm test`
- Run a single test file: `node --import tsx --test test/input-filter.test.ts`
- Build the web app bundle used by the embedded server: `pnpm build:web`

## Web app commands

Run these from `web/`:

- Install web dependencies: `pnpm install`
- Start the Vite dev server: `pnpm dev`
- Build the React app: `pnpm build`
- Preview the production build: `pnpm preview`

To run the CLI against the Vite dev server instead of built assets, start the web app and launch the CLI with `RJ_WEB_DEV=1`.

## Architecture overview

### CLI and TUI runtime

- `src/cli.ts` is the process entrypoint. It handles `--help` / `--version` and starts the interactive app.
- `src/app.ts` contains `RJApp`, the main orchestration layer for the terminal UI. It wires together config loading, message state, slash commands, AI requests, subagents, selector dialogs, session restore/save, and the embedded rank page server.
- The TUI is built on `@mariozechner/pi-tui`. UI state and message rendering are split across `src/ui/` and `src/app/` helpers.

### AI integration

- `src/core/ai.ts` implements the streaming OpenAI-compatible chat loop. It keeps sending conversation history, streams assistant output, executes tool calls, appends tool results, and continues until the model stops requesting tools.
- `src/prompts/system.ts` defines the in-app system prompt and the behavior contract for tool usage.
- `src/subagent/runner.ts` and `src/app/subagent-runner.ts` implement the read-only explore subagent flow. Subagents are meant for multi-file analysis and return a structured summary back to the main agent.

### Commands and session state

- `src/core/commands.ts` defines built-in slash commands such as `/model`, `/rank`, `/circle`, `/works`, `/session`, `/workMatch`, `/workMatchMulti`, and `/uploadMegaFile`.
- `src/core/session.ts` persists chat sessions in `~/.RJ/sessions` and supports restoring prior conversations.
- `src/core/config.ts` loads app config from `~/.RJ/config.json`, manages model/provider defaults, and loads subagent definitions.

### RJ data and local server

- `src/tools/rj-server/` contains the main domain logic for RJ ranking, circle management, works management, and resource matching.
- `src/tools/rj-server/db.ts` manages the SQLite database in `~/.RJ/rj.db` and related data/cache directories under `~/.RJ`.
- `src/tools/rj-server/index.ts` exposes the operations used by the app and local HTTP API.
- `src/tools/rj-server/scraper.ts` fetches and parses DLsite ranking/detail pages, with proxy support via environment variables.
- `src/app/rank-page.ts` starts the embedded local HTTP server, serves the built frontend pages, and exposes `/api/*` endpoints consumed by the web UI.

### Local work processing

- `src/tools/rj-server/work-ops.ts` implements the local audio-folder workflow used by `/workMatch` and `/workMatchMulti`.
- It scans folder structures, extracts RJ IDs from names, previews conversion plans, selects cover images, and runs format conversion with `ffmpeg`.

### Web frontend

- `web/` is a separate React 19 + Vite application with Tailwind CSS v4.
- `web/vite.config.ts` builds multiple HTML entry points (`rank`, `circle`, `works`) and proxies `/api` to the embedded backend during development.
- `web/src/lib/api.ts` centralizes frontend API requests.
- `web/src/pages/RankPage.tsx`, `CirclePage.tsx`, and `WorksPage.tsx` are the main pages for ranking management, circle management, and local works inventory.

## Repository conventions

These conventions come from `AGENTS.md` and should be followed when modifying code:

- 函数统一使用箭头函数编写。
- 描述对象形状且需要被类实现、声明合并或对外扩展时，使用 `interface`。
- 描述联合类型、交叉类型、工具类型、函数类型、元组或需要类型运算时，使用 `type`。
- 注释使用中文。
- 变量、`type`、`interface`、`enum` 等使用单行注释说明。
- 方法使用多行注释说明。
- 方法内部关键部位按需添加简短中文注释，说明关键逻辑、边界条件或非直观决策。

## Useful runtime details

- Persistent app data lives under `~/.RJ/`, including `config.json`, `sessions/`, `rj.db`, and cached artifacts.
- The embedded server normally serves prebuilt assets from `web/dist/`; in dev mode it can work with the Vite server.
- Some features assume local tools and services are available, especially `ffmpeg` for work processing and a reachable proxy for DLsite scraping when direct access is unavailable.
