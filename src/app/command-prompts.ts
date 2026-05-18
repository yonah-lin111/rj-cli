import type { RankSelection } from "../ui/rank-selector.ts";
import type { ResourceMatchSelection } from "../tools/rj-server/index.ts";
import type { WorksSelection } from "../ui/works-selector.ts";
import type { CircleSelection } from "../ui/circle-selector.ts";
import type { OpenUrlCommand } from "./open-url.ts";

export type ChatSubmission = {
  kind: "user" | "command";
  displayText: string;
  promptText: string;
  label?: string;
};

const RANK_PERIOD_NAMES: Record<RankSelection["rankingType"], string> = {
  "24h": "天",
  "7d": "周",
  "30d": "月",
  year: "年",
};

const RANK_PERIOD_FLAGS: Record<RankSelection["rankingType"], string> = {
  "24h": "-Day",
  "7d": "-Week",
  "30d": "-Month",
  year: "-Year",
};

const WORKS_PRESET_FLAGS: Record<WorksSelection["queryPreset"], string> = {
  all: "-All",
  "latest-added": "-Latest added",
  "latest-undownloaded": "-Latest undownloaded",
};

export const buildResourceMatchCommandPrompt = (
  mode: "mega" | "asmrone",
  selection: ResourceMatchSelection,
): ChatSubmission => {
  const isMega = mode === "mega";
  const displayText = isMega
    ? selection.matchAll ? "/matchMega -All" : `/matchMega -RJ [${selection.rjCode}]`
    : selection.matchAll ? "/matchASMROne -All" : `/matchASMROne -RJ [${selection.rjCode}]`;
  const toolName = isMega ? "match_mega_resources" : "match_asmrone_resources";
  const argsText = selection.matchAll
    ? "{\"match_all\":true}"
    : `{\"match_all\":false,\"rj_code\":${JSON.stringify(selection.rjCode)}}`;
  const title = isMega ? "Mega 资源匹配结果" : "ASMR.ONE 资源匹配结果";
  const targetSource = isMega ? "mega" : "asmrone";

  return {
    kind: "command",
    displayText,
    promptText: `请调用 ${toolName} 工具检查资源是否存在。\n\n要求：\n1. 先且只调用一次 ${toolName}，参数使用 ${argsText}\n2. 如果工具返回错误，直接输出错误信息，不要继续 ask、todowrite 或 rj_set_source\n3. 如果返回 message 且 total=0，直接输出该 message，不要继续 ask、todowrite 或 rj_set_source\n4. 如果 matched=0，只按结果结构输出匹配结果，不要继续 ask、todowrite 或 rj_set_source\n5. 如果存在命中项：\n   - 直接使用匹配结果里的 current_source 作为数据库当前来源，禁止再把匹配结果里的 source 当作当前来源\n   - 单个 RJ 命中时，先明确说明“数据库当前来源(current_source)”和“本次匹配来源(${targetSource})”，对比后再调用一次 ask 确认是否更新；如果两者相同，也要明确说明通常无需更新\n   - 批量命中时，先按命中项逐个列出“数据库当前来源(current_source)”和“本次匹配来源(${targetSource})”，让用户可以对比判断是否需要更新，再调用一次 ask 确认是否批量更新\n   - 批量流程进入多步骤处理时，再使用 todowrite 跟踪“确认更新范围 / 批量更新 source / 汇总结果”\n   - 只有在用户明确确认后，才能对确认范围内且确实需要变更的 RJ 调用 rj_set_source，并将 source 设置为 ${targetSource}\n6. 输出结果时使用以下结构：\n   - 第一行输出标题：${title}\n   - 接着输出摘要：检查总数、存在、不存在、失败\n   - 单个 RJ 时输出：RJ、数据库当前来源、本次匹配来源、是否建议更新、结果、标题、社团、补充说明\n   - 批量时输出命中列表（包含数据库当前来源、本次匹配来源、是否建议更新）、未命中 RJ、失败 RJ\n7. 如果执行了 source 更新，在资源匹配结果后追加“来源处理结果”摘要\n8. 不要输出思考过程，不要输出 JSON 原文`,
    label: "command",
  };
};

export const buildRankCommandPrompt = (selection: RankSelection): ChatSubmission => ({
  kind: "command",
  displayText: `/rank -View only ${RANK_PERIOD_FLAGS[selection.rankingType]} -${selection.pageSize} rows`,
  promptText: `请输出 RJ ${RANK_PERIOD_NAMES[selection.rankingType]}排行榜前 ${selection.pageSize} 条：
1. 调用 rj_get_ranking，参数 ranking_type="${selection.rankingType}"、page=1、page_size=${selection.pageSize}
2. 将返回 items 渲染为 Markdown 表格，列包含 排名、RJ号、标题、社团、CV、发售日
3. 只在回复中输出表格，不导出文件`,
  label: "command",
});

export const buildOpenRankPagePrompt = (
  selection: RankSelection,
  opener: OpenUrlCommand,
  url: string,
): ChatSubmission => ({
  kind: "command",
  displayText: `/rank -Open page ${RANK_PERIOD_FLAGS[selection.rankingType]} -${selection.pageSize} rows`,
  promptText: `请使用 bash 工具打开 RJ 排行榜页面，并在命令执行后简短说明页面已打开，支持分页、排行周期切换以及 RJ号/标题/社团/CV 条件查询。

要求：
1. 当前系统打开命令是 ${opener.command}
2. 页面地址是 ${url}
3. 只调用一次 bash 工具打开页面
4. 命令中必须安全引用 URL，不要拼接未转义的参数
5. bash 完成后简短回复打开结果`,
  label: "command",
});

export const buildCircleCommandPrompt = (selection: CircleSelection): ChatSubmission => ({
  kind: "command",
  displayText: `/circle [${selection.circleName}]`,
  promptText: `请输出社团”${selection.circleName}”的详情和最新发布作品：
1. 调用 circle_get_detail，参数 name=${selection.circleName}
2. 调用 circle_get_latest_works，参数 circle_name=${selection.circleName}、limit=10
3. 输出”社团基本信息”小节：社团名、昵称、链接、备注、创建时间、本地作品数
4. 输出”DLsite 最新 10 部作品”Markdown 表格：RJ号、标题、发售日、全年龄
5. 标题非空时渲染为 Markdown 链接（使用 title_url）
6. 如果 circle_get_latest_works 返回错误或 items 为空，输出”暂无最新作品（可能未设置 circle_url）”
7. 只输出结果，不导出文件`,
  label: "command",
});

export const buildOpenCirclePagePrompt = (opener: OpenUrlCommand, url: string): ChatSubmission => ({
  kind: "command",
  displayText: "/circle -Open page",
  promptText: `请使用 bash 工具打开本地社团管理页面，并在命令执行后简短说明页面已打开，支持社团新增/编辑/删除，以及社团作品查询、添加和移除。

要求：
1. 当前系统打开命令是 ${opener.command}
2. 页面地址是 ${url}
3. 只调用一次 bash 工具打开页面
4. 命令中必须安全引用 URL，不要拼接未转义的参数
5. bash 完成后简短回复打开结果`,
  label: "command",
});

export const buildWorksCommandPrompt = (selection: WorksSelection): ChatSubmission => {
  const filters = ["page=1", "page_size=5"];
  if (selection.queryPreset === "latest-undownloaded") {
    filters.push("status=0");
  }
  if (selection.circleName) {
    filters.push(`circle=${JSON.stringify(selection.circleName)}`);
  }

  const presetText = selection.queryPreset === "latest-undownloaded"
    ? "最新 5 条未下载作品"
    : selection.queryPreset === "latest-added"
      ? "最新 5 条已添加作品"
      : "全部作品";
  const circleFlag = selection.circleName ? ` -Circle [${selection.circleName}]` : "";

  return {
    kind: "command",
    displayText: `/works -View only ${WORKS_PRESET_FLAGS[selection.queryPreset]}${circleFlag}`,
    promptText: `请查询本地作品数据并只输出结果表格：
1. 调用 rj_query，参数 ${filters.join("、")}
2. 将返回 data 渲染为 Markdown 表格，列至少包含 RJ号、标题、社团、状态、创建时间
3. 如果标题存在且带有 title_url，则渲染为 Markdown 链接
4. 不要输出解释、总结或额外文字，本次查询目标是：${presetText}${selection.circleName ? `（社团：${selection.circleName}）` : ""}`,
    label: "command",
  };
};

export const buildOpenWorksPagePrompt = (
  selection: WorksSelection,
  opener: OpenUrlCommand,
  url: string,
): ChatSubmission => {
  const circleFlag = selection.circleName ? ` -Circle [${selection.circleName}]` : "";
  return {
    kind: "command",
    displayText: `/works -Open page ${WORKS_PRESET_FLAGS[selection.queryPreset]}${circleFlag}`,
    promptText: `请使用 bash 工具打开本地作品管理页面，并在命令执行后简短说明页面已打开，支持分页、预设切换、社团/RJ号/标题筛选，以及查看详情和下载链接。

要求：
1. 当前系统打开命令是 ${opener.command}
2. 页面地址是 ${url}
3. 只调用一次 bash 工具打开页面
4. 命令中必须安全引用 URL，不要拼接未转义的参数
5. bash 完成后简短回复打开结果`,
    label: "command",
  };
};
