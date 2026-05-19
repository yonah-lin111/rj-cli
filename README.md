# RJ CLI

A local interactive CLI for RJ work management, combining a terminal TUI, an embedded Web UI, local SQLite storage, ranking ingestion, resource matching, and local audio/workflow processing.

## Overview

- Use AI together with local tools inside an interactive terminal TUI.
- Manage local RJ data including ranked works, circles, work status, and chat sessions.
- Provide an embedded Web UI for viewing and operating on rankings, circles, works, and local work-processing tasks.
- Fetch ranking data, inspect work details, and cache structured information into a local database.
- Match Mega and ASMR.ONE resources for local works.
- Process local work folders with preview, cover selection, overwrite confirmation, format conversion, and organized output.
- Support a read-only subagent exploration mode for multi-file analysis.

## Core Capabilities

### 1. Terminal Interaction

The CLI entry point is `src/cli.ts`. After startup, it enters a terminal UI built with `@mariozechner/pi-tui`.

Built-in capabilities include:

- Model switching
- Settings selection
- Session save and restore
- Slash command execution
- Interactive Ask prompts
- Tool calls such as Bash / file read-write / Todo
- Read-only subagent exploration
- Embedded Web UI launching

### 2. RJ Data Management

Local data is mainly stored under `~/.RJ/`:

- `~/.RJ/rj.db`: SQLite database
- `~/.RJ/sessions/`: chat session history
- `~/.RJ/config.json`: configuration file
- Other cache and artifact directories

Supported data operations include:

- Fetching and caching ranking data
- Adding or removing RJ works
- Adding or removing circles
- Querying RJ info from the last QA result or a specified RJ code
- Querying circle details, circle works, and latest circle works
- Querying local work lists and updating work status
- Generating local database overview summaries
- Copying selected local files into `~/.RJ/`

### 3. Web UI

The project includes a React 19 + Vite frontend in `web/` for graphical data viewing and operations.

Current pages include:

- `RankPage`: ranking management
- `CirclePage`: circle management
- `WorksPage`: work list, status updates, deletion, and resource matching
- `WorkOpsPage`: local work preview and processing page

The CLI starts a local HTTP server automatically. The embedded backend serves the following page routes:

- `/rank`
- `/circle`
- `/works`
- `/work-ops`

When `RJ_WEB_DEV=1` is enabled, the CLI can also connect to the Vite development server and spawn the frontend dev process automatically.

### 4. Local Work Processing

`src/tools/rj-server/work-ops.ts` provides local audio folder processing workflows for organizing work directories.

Supported flow includes:

- Extracting RJ IDs from folder names
- Scanning audio files, image files, and other files
- Previewing output directory structure before execution
- Selecting a cover image
- Choosing output base path
- Choosing target format (`flac`, `mp3`, or no conversion)
- Configuring worker thread count
- Selecting subfolders in multi-folder mode
- Confirming overwrite behavior
- Calling `ffmpeg` for format conversion
- Batch copying and organizing output files
- Single-folder and multi-folder modes

### 5. Resource Matching

The project currently supports the following resource matching features:

- Mega resource matching
- ASMR.ONE resource matching

Related logic is located in:

- `src/tools/rj-server/resource-match.ts`
- `src/tools/rj-server/index.ts`
- `web/src/pages/WorksPage.tsx`

## Requirements

- Node.js >= 20
- pnpm
- A usable terminal on macOS / Linux
- `ffmpeg` if local audio processing is needed

## Install Dependencies

Run in the project root:

```bash
pnpm install
```

If the Web frontend needs to be built, the root scripts will also install dependencies in `web/` automatically.

## Getting Started

### Start the CLI

```bash
pnpm dev
```

### Show help

```bash
node dist/cli.js --help
```

During development, you can also use the entry arguments directly:

```bash
pnpm dev --help
pnpm dev --version
```

### Run against the Vite dev server

Start the web app in development mode and let the CLI proxy to it:

```bash
RJ_WEB_DEV=1 pnpm dev
```

## Common Development Commands

### Root directory

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm build:web
```

Descriptions:

- `pnpm dev`: start the CLI in development mode
- `pnpm typecheck`: run TypeScript type checking
- `pnpm test`: run root tests
- `pnpm build:web`: install and build the Web frontend

### Web directory

Run inside `web/`:

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
```

## Common Slash Commands

Based on the current codebase, the following built-in commands are commonly available:

- `/help`
- `/model [search]`
- `/setting`
- `/webUI`
- `/rank`
- `/matchMega [RJ code]`
- `/matchASMROne [RJ code]`
- `/circle`
- `/works`
- `/session`
- `/info [RJ code]`
- `/overwrite`
- `/workMatch [path]`
- `/workMatchMulti [path]`
- `/uploadMegaFile -[path]`
- `/clear`
- `/undo`
- `/quit`

Notes:

- `/info` shows the RJ info from the last completed QA or from the RJ code inside `[]`.
- `/overwrite` generates a Chinese overview from the local RJ database. It does not overwrite files.
- `/workMatch` is for a single folder whose audio files are directly under the folder root.
- `/workMatchMulti` is for a root folder whose subfolders each contain audio files.
- `/uploadMegaFile` copies a selected local file into `~/.RJ/` and may ask for overwrite confirmation.

Command definitions are located in `src/core/commands.ts`.

## Project Structure

```text
.
├── src/
│   ├── cli.ts                 # CLI entry
│   ├── app.ts                 # Main TUI app and interaction orchestration
│   ├── core/                  # Config, AI, commands, sessions, and core logic
│   ├── app/                   # Page services, action handlers, context helpers
│   ├── tools/                 # Bash / file / RJ service / local tools
│   ├── ui/                    # TUI components
│   ├── prompts/               # System prompt and tool descriptions
│   └── subagent/              # Subagent runtime logic
├── web/                       # React + Vite Web frontend
├── test/                      # Root tests
└── CLAUDE.md                  # Project development conventions
```

## Architecture Overview

### CLI / TUI Layer

- `src/cli.ts`: handles `--help`, `--version`, and starts the app
- `src/app.ts`: main app class `RJApp`, orchestrating messages, tools, subagents, sessions, and local services
- `src/ui/`: terminal UI components

### AI and Tool Layer

- `src/core/ai.ts`: streaming chat loop and tool execution
- `src/prompts/system.ts`: system prompt
- `src/tools/base/`: base tools such as Bash, file read-write, Ask, and Todo
- `src/subagent/runner.ts`: subagent runtime logic

### Data and Service Layer

- `src/tools/rj-server/db.ts`: SQLite database access
- `src/tools/rj-server/index.ts`: unified entry for RJ-related tool capabilities
- `src/tools/rj-server/scraper.ts`: DLsite page fetching and parsing
- `src/app/rank-page.ts`: embedded local HTTP server and `/api/*` routes for the Web UI

### Frontend Layer

- `web/src/pages/RankPage.tsx`
- `web/src/pages/CirclePage.tsx`
- `web/src/pages/WorksPage.tsx`
- `web/src/pages/WorkOpsPage.tsx`

## Runtime Notes

- Persistent app data is stored under `~/.RJ/`
- By default, the embedded server serves built static assets from `web/dist/`
- When `RJ_WEB_DEV=1` is set, the CLI can work with the Vite development server and start the frontend dev process automatically
- Some scraping features may depend on available network access or proxy configuration

## Development Conventions Summary

Current project conventions include:

- Prefer arrow functions
- Prefer `interface` for externally extensible object shapes
- Prefer `type` for type operations and union types
- Use Chinese for code comments

See `CLAUDE.md` for full conventions.

## Use Cases

This project is suitable for:

- Local RJ data archiving and management
- Quickly importing works and circle information from rankings
- Viewing local work and circle data through an embedded Web UI
- Matching works against Mega and ASMR.ONE resources
- Organizing and converting local audio work folders
- Completing semi-automated workflows with AI + tools
