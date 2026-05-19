# RJ CLI

一个面向 RJ 作品管理场景的本地交互式 CLI，集成终端 TUI、嵌入式 Web UI、本地 SQLite 存储、排行榜入库、资源匹配与本地音频处理流程。

## 功能简介

- 在终端中以交互式 TUI 方式使用 AI 与本地工具协作。
- 管理本地 RJ 数据，包括排行榜作品、社团、作品状态与会话记录。
- 提供嵌入式 Web UI，用于查看和操作排行榜、社团、作品列表以及本地作品处理任务。
- 支持抓取排行榜、查看作品信息，并将结构化数据写入本地数据库缓存。
- 支持为本地作品匹配 Mega 与 ASMR.ONE 资源。
- 支持对本地作品文件夹执行预览、封面选择、覆盖确认、格式转换与输出整理。
- 支持子代理探索模式，用于多文件只读分析。

## 主要能力

### 1. 终端交互

CLI 入口位于 `src/cli.ts`，启动后会进入基于 `@mariozechner/pi-tui` 构建的终端界面。

内置能力包括：

- 模型切换
- 设置选择
- 会话保存与恢复
- 斜杠命令执行
- Ask 交互提问
- Bash / 读写文件 / Todo 等工具调用
- Subagent 只读探索
- 嵌入式 Web UI 启动

### 2. RJ 数据管理

本地数据主要保存在 `~/.RJ/`：

- `~/.RJ/rj.db`：SQLite 数据库
- `~/.RJ/sessions/`：聊天会话历史
- `~/.RJ/config.json`：配置文件
- 其他缓存与产物目录

支持的数据操作包括：

- 获取排行榜并缓存
- 添加/移除 RJ 作品
- 添加/移除社团
- 从上一轮问答结果或指定 RJ 号查询作品信息
- 查询社团详情、社团作品以及社团最新作品
- 查询本地作品列表并更新作品状态
- 生成本地数据库概览
- 将指定本地文件复制到 `~/.RJ/`

### 3. Web UI

项目内置 `web/` React 19 + Vite 前端，可用于图形化查看和操作数据。

当前页面包括：

- `RankPage`：排行榜管理
- `CirclePage`：社团管理
- `WorksPage`：作品列表、状态更新、删除与资源匹配
- `WorkOpsPage`：本地作品预览与处理页面

CLI 启动时会自动拉起本地 HTTP 服务。嵌入式后端当前提供以下页面路由：

- `/rank`
- `/circle`
- `/works`
- `/work-ops`

当启用 `RJ_WEB_DEV=1` 时，CLI 也可以连接到 Vite 开发服务器，并自动拉起前端开发进程。

### 4. 本地作品处理

`src/tools/rj-server/work-ops.ts` 提供本地音频文件夹处理能力，适合整理作品目录。

支持流程包括：

- 从文件夹名中提取 RJ 编号
- 扫描音频文件、图片文件与其他文件
- 在执行前预览输出目录结构
- 选择封面图
- 选择输出根目录
- 选择目标格式（`flac`、`mp3` 或不转换）
- 配置工作线程数
- 在多文件夹模式下选择需要处理的子文件夹
- 确认覆盖行为
- 调用 `ffmpeg` 进行格式转换
- 批量复制并整理输出文件
- 支持单文件夹与多文件夹两种模式

### 5. 资源匹配

当前支持以下资源匹配能力：

- Mega 资源匹配
- ASMR.ONE 资源匹配

相关逻辑位于：

- `src/tools/rj-server/resource-match.ts`
- `src/tools/rj-server/index.ts`
- `web/src/pages/WorksPage.tsx`

## 安装要求

- Node.js >= 20
- pnpm
- macOS / Linux 环境下可用的终端
- 若需要本地音频处理，需额外安装 `ffmpeg`

## 安装依赖

在项目根目录执行：

```bash
pnpm install
```

如需构建 Web 前端，根目录脚本会自动进入 `web/` 安装其依赖。

## 启动方式

### 启动 CLI

```bash
pnpm dev
```

### 查看帮助

```bash
node dist/cli.js --help
```

开发阶段也可直接参考入口参数逻辑：

```bash
pnpm dev --help
pnpm dev --version
```

### 连接 Vite 开发服务器

在开发模式下让 CLI 对接前端开发服务器：

```bash
RJ_WEB_DEV=1 pnpm dev
```

## 常用开发命令

### 根目录

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm build:web
```

说明：

- `pnpm dev`：启动 CLI 开发模式
- `pnpm typecheck`：执行 TypeScript 类型检查
- `pnpm test`：运行根目录测试
- `pnpm build:web`：安装并构建 Web 前端

### Web 目录

在 `web/` 目录执行：

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
```

## 典型斜杠命令

根据当前代码，内置了以下常用命令：

- `/help`
- `/model [search]`
- `/setting`
- `/webUI`
- `/rank`
- `/matchMega [RJ号]`
- `/matchASMROne [RJ号]`
- `/circle`
- `/works`
- `/session`
- `/info [RJ号]`
- `/overwrite`
- `/workMatch [path]`
- `/workMatchMulti [path]`
- `/uploadMegaFile -[path]`
- `/clear`
- `/undo`
- `/quit`

说明：

- `/info` 用于展示上一轮已完成问答中的 RJ 信息，或展示 `[]` 中指定的 RJ 号。
- `/overwrite` 会基于本地 RJ 数据库生成中文概览，并不是文件覆盖命令。
- `/workMatch` 适用于音频文件直接位于目标目录根层级的单文件夹作品。
- `/workMatchMulti` 适用于根目录下多个子文件夹分别存放音频文件的场景。
- `/uploadMegaFile` 会把指定本地文件复制到 `~/.RJ/`，必要时会要求确认是否覆盖。

命令定义位于 `src/core/commands.ts`。

## 项目结构

```text
.
├── src/
│   ├── cli.ts                 # CLI 入口
│   ├── app.ts                 # TUI 主应用与交互编排
│   ├── core/                  # 配置、AI、命令、会话等核心逻辑
│   ├── app/                   # 页面服务、动作处理、上下文辅助等
│   ├── tools/                 # Bash / 文件 / RJ 服务 / 本地工具
│   ├── ui/                    # TUI 组件
│   ├── prompts/               # 系统提示词与工具描述
│   └── subagent/              # 子代理运行逻辑
├── web/                       # React + Vite Web 前端
├── test/                      # 根目录测试
└── CLAUDE.md                  # 项目开发约定
```

## 架构概览

### CLI / TUI 层

- `src/cli.ts`：处理 `--help`、`--version` 并启动应用
- `src/app.ts`：主应用类 `RJApp`，编排消息、工具、子代理、会话与本地服务
- `src/ui/`：终端界面组件

### AI 与工具层

- `src/core/ai.ts`：流式聊天循环与工具调用
- `src/prompts/system.ts`：系统提示词
- `src/tools/base/`：Bash、文件读写、Ask、Todo 等基础工具
- `src/subagent/runner.ts`：子代理运行逻辑

### 数据与服务层

- `src/tools/rj-server/db.ts`：SQLite 数据库访问
- `src/tools/rj-server/index.ts`：RJ 相关工具能力统一出口
- `src/tools/rj-server/scraper.ts`：DLsite 页面抓取与解析
- `src/app/rank-page.ts`：嵌入式本地 HTTP 服务与 Web UI 使用的 `/api/*` 路由

### 前端层

- `web/src/pages/RankPage.tsx`
- `web/src/pages/CirclePage.tsx`
- `web/src/pages/WorksPage.tsx`
- `web/src/pages/WorkOpsPage.tsx`

## 运行细节

- 持久化数据目录默认在 `~/.RJ/`
- 默认情况下嵌入式服务会提供构建后的 `web/dist/` 静态资源
- 当设置 `RJ_WEB_DEV=1` 时，CLI 可以配合 `web/` 下的 Vite 开发服务器工作，并自动拉起前端开发进程
- 某些抓取功能可能依赖可用网络环境或代理配置

## 开发约定摘要

项目当前约定包括：

- 函数优先使用箭头函数
- 对外可扩展对象结构优先使用 `interface`
- 类型运算与联合类型优先使用 `type`
- 注释使用中文

详细规范见 `CLAUDE.md`。

## 适用场景

这个项目适合用于：

- 本地 RJ 数据归档与管理
- 从排行榜快速入库作品与社团信息
- 通过嵌入式 Web UI 查看本地作品与社团数据
- 为作品匹配 Mega 与 ASMR.ONE 资源
- 对本地音频作品目录执行整理与格式转换
- 借助 AI + 工具流完成半自动化操作
