export const toolsPrompt = `
read_file(path)
Read the contents of a file from the local filesystem.

Usage:
- The path parameter should be an absolute path.
- Always read_file before edit_file to understand the current content.
- Use this tool when the user asks about or wants to modify a specific file.

write_file(path, content)
Create or overwrite a file with the given content.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- You MUST use read_file first if the file already exists.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.

edit_file(path, edits)
Apply exact string replacements to an existing file.

Usage:
- You must call read_file at least once before editing.
- Each edit has oldText (must be unique in the file) and newText.
- The edit will FAIL if oldText is not found or matches multiple locations.
- Prefer edit_file over write_file when modifying existing files to avoid overwriting unrelated content.

bash(command)
Run a non-interactive shell command in the current working directory.

Usage:
- Use only when you need to run commands, project scripts, tests, or builds.
- Use the smallest necessary shell command.
- Avoid long-running, interactive, or high-risk commands.
- Output may be truncated; commands that exceed the timeout are terminated.

todowrite(todos)
Create and manage a structured todo list for the current coding session.

Each todo has: content, status (pending | in_progress | completed | cancelled), priority (high | medium | low).

When to use:
- Complex multistep tasks requiring 3 or more distinct steps
- User explicitly requests a todo list
- User provides multiple tasks at once

When NOT to use:
- Single, straightforward tasks
- Tasks completable in fewer than 3 trivial steps
- Purely conversational or informational requests

Usage:
- Keep exactly one todo in_progress at a time.
- Mark tasks completed immediately after finishing — do not batch completions.
- Update statuses in real-time as work progresses.

ask(questions)
Ask the user one or more questions and wait for their answers before continuing.

Each question has: question (full text), header (short label ≤30 chars), options (array of {label, description}),
optional multiple (allow multi-select, default false), optional custom (allow free-text answer, default true).

Usage:
- Use this to clarify ambiguous instructions, gather preferences, or get decisions before proceeding.
- Answers are returned as arrays of selected labels.
- If you recommend a specific option, make it first and append "(Recommended)" to its label.
- When custom is enabled (default), a free-text input is added automatically — do not include an "Other" option.
- Prefer a single ask call with all questions rather than multiple sequential calls.

rj_work_ops_preview(source_path, target_format, output_base_path?, multi_folder?)
Preview work processing before execution. Scans the source folder, extracts RJ code from the folder name,
matches the DB record, and returns the file list and output path preview.

Usage:
- Always call this FIRST before rj_work_ops_process.
- Use target_format="flac" as the default.
- Set multi_folder=false for single-folder mode (audio files at root), multi_folder=true for multi-folder mode (subfolders each contain audio).
- Use the result to show the user what will happen before any files are modified.

circle_add_by_rg(rj_code, circle_url?, nickname?, remark?)
Add a circle to the local circle library by looking up an existing RJ work record.

Usage:
- Use this when the user gives an RJ code and wants to add its circle without typing the circle name manually.
- Prefer local RJ data first; this tool will only fall back to the work detail page when needed.
- If the RJ record lacks enough circle information, use circle_add instead.

voice_metadata_scan(source_path)
Scan a directory for mp3/flac files and read title, artist, album, and cover status.

Usage:
- Use this first when the user wants to inspect existing audio metadata.
- This tool only reads metadata and does not modify files.

voice_metadata_update(source_path, relative_path, title?, artist?, album?, cover_image_path?, cover_image_base64?, remove_cover?)
Update metadata for a single audio file.

Usage:
- Use this for single-file metadata edits.
- relative_path must point to a file under source_path.
- Use remove_cover=true to delete the embedded cover.
- Use cover_image_path or cover_image_base64 to replace the cover.

voice_metadata_apply_template(source_path, relative_paths?, title_mode?, title_template?, artist?, album?, cover_image_path?, cover_image_base64?, remove_cover?)
Batch-apply metadata to multiple audio files in a directory.

Usage:
- Use this for bulk metadata changes such as unified artist, album, title rules, or cover image.
- Use title_mode="filename" to set title from each filename.
- Use title_mode="template" together with title_template for custom batch titles.
- Do not use this tool as a replacement for rj_work_ops_process.

rj_work_ops_process(source_path, target_format, keep_source, threads, output_base_path, force_overwrite?, multi_folder?, selected_folders?, cover_image?)
Execute audio format conversion and file organization with real-time progress updates.

Parameters:
- target_format: flac | mp3 | none
- keep_source: true to preserve originals
- threads: 1–8 (default 2)
- multi_folder: false for single-folder mode, true for multi-folder mode
- selected_folders: only used in multi_folder=true mode

Single-folder workflow (/workMatch):
1. Call rj_work_ops_preview with multi_folder=false.
2. Call ask ONCE with ALL of the following questions:
   Q1 header="格式转换"  — options: flac (Recommended), mp3, none
   Q2 header="线程数"    — options: 2 (Recommended), 1, 4, 8
   Q3 header="保留源文件" — options: 是 (Recommended), 否
   Q4 header="封面图片"  — list image filenames from preview; custom=true
   Q5 header="输出路径"  — show output_path_preview as first option (Recommended); custom=true
3. Call rj_work_ops_process with multi_folder=false.

Multi-folder workflow (/workMatchMulti):
1. Call rj_work_ops_preview with multi_folder=true.
2. Call ask ONCE with ALL of the following questions:
   Q1 header="格式转换"  — options: flac (Recommended), mp3, none
   Q2 header="线程数"    — options: 2 (Recommended), 1, 4, 8
   Q3 header="保留源文件" — options: 是 (Recommended), 否
   Q4 header="封面图片"  — list image filenames from preview; custom=true
   Q5 header="输出路径"  — show output_path_preview as first option (Recommended); custom=true
   Q6 header="选择子文件夹" — list sub_folder names from preview; multiple=true
3. Call rj_work_ops_process with multi_folder=true and selected_folders from Q6.

works_update_status(rj_code, status)
更新 /works 页面指定作品的状态。

Usage:
- 仅用于 /works 页面语义下的状态更新。
- status: 0=未下载，1=已下载，2=已删除。

rj_set_source(rj_code, source, matched_url?)
更新本地 RJ 作品来源。

Usage:
- 用于资源匹配命中后的来源确认场景。
- source: mega | asmrone。
- Mega 场景可传 matched_url，同步写入 download_links。
- asmrone 场景会清空旧 download_links，即使传入 matched_url 也会忽略。
- 资源匹配成功后如需更新来源，应先通过 ask 确认，再调用此工具。
- 多个命中项需要分步骤处理时，可配合 todowrite 跟踪确认范围、批量更新与结果汇总。

match_mega_resources(match_all?, rj_code?)
Check whether resources exist in Mega. Supports checking all pending local works or a single RJ code.

Usage:
- 这是查询型工具，只负责返回匹配结果，不直接修改作品来源。
- 若 match_all=false，则必须提供 rj_code。
- 命中结果会结构化返回 source=mega 与 matched_url。
- 资源匹配成功后，如需变更 source 为 mega，应先通过 ask 确认，再调用 rj_set_source。

match_asmrone_resources(match_all?, rj_code?)
Check whether resources exist in ASMR.ONE. Supports checking all pending local works or a single RJ code.

Usage:
- 这是查询型工具，只负责返回匹配结果，不直接修改作品来源。
- 若 match_all=false，则必须提供 rj_code。
- 命中结果会结构化返回 source=asmrone，且不返回 matched_url。
- 资源匹配成功后，如需变更 source 为 asmrone，应先通过 ask 确认，再调用 rj_set_source。

explore(task, reuseMode?, subagentId?)
Delegate file exploration to an explore subagent.

Usage:
- reuseMode: auto (default) | reuse | new
- For follow-up exploration on the same topic, prefer auto or reuse so the subagent can continue from prior context.
- Use new for unrelated topics or when previous context may contaminate results.
- subagentId can target a specific existing instance.
`.trim();
