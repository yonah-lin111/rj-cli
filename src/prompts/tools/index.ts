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
- Use the result to show the user what will happen before any files are modified.

rj_work_ops_process(source_path, target_format, keep_source, threads, output_base_path, force_overwrite?, multi_folder?, selected_folders?, cover_image?)
Execute audio format conversion and file organization with real-time progress updates.

Parameters:
- target_format: flac | mp3 | none
- keep_source: true to preserve originals
- threads: 1–8 (default 2)
- In multi_folder mode, use selected_folders to specify which subfolders to process.

Recommended workflow:
1. Call rj_work_ops_preview to get file list and cover info.
2. Call ask ONCE with ALL of the following questions in a single call:
   Q1 header="格式转换"  — options: flac (Recommended), mp3, none
   Q2 header="线程数"    — options: 2 (Recommended), 1, 4, 8
   Q3 header="保留源文件" — options: 是 (Recommended), 否
   Q4 header="封面图片"  — list image filenames from preview; custom=true
   Q5 header="输出路径"  — show output_path_preview as first option (Recommended); custom=true
   If multi_folder: also add Q6 header="选择子文件夹" with sub_folder names; multiple=true
3. Call rj_work_ops_process with the confirmed parameters.

explore(task, reuseMode?, subagentId?)
Delegate file exploration to an explore subagent.

Usage:
- reuseMode: auto (default) | reuse | new
- For follow-up exploration on the same topic, prefer auto or reuse so the subagent can continue from prior context.
- Use new for unrelated topics or when previous context may contaminate results.
- subagentId can target a specific existing instance.
`.trim();
