import { useMemo, useState } from "react";
import { PageHeaderNav } from "@/components/page-header-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { previewWorkOps, runWorkOpsProcess } from "@/lib/api";
import type { WorkOpsPreviewResponse, WorkOpsProgressEvent } from "@/types";

const TARGET_FORMAT_OPTIONS = [
  { value: "flac", label: "FLAC" },
  { value: "mp3", label: "MP3" },
  { value: "none", label: "No Convert" },
] as const;

const THREAD_OPTIONS = ["1", "2", "4", "8"] as const;

const getEventTone = (step: string): string => {
  if (step === "error") return "text-red-400";
  if (step === "done") return "text-emerald-400";
  if (step === "confirm_overwrite") return "text-amber-400";
  return "text-zinc-400";
};

export default function WorkOpsPage(): React.ReactElement {
  const [sourcePath, setSourcePath] = useState("");
  const [outputBasePath, setOutputBasePath] = useState("");
  const [targetFormat, setTargetFormat] = useState<(typeof TARGET_FORMAT_OPTIONS)[number]["value"]>("flac");
  const [multiFolder, setMultiFolder] = useState(false);
  const [keepSource, setKeepSource] = useState(true);
  const [threads, setThreads] = useState<(typeof THREAD_OPTIONS)[number]>("2");
  const [selectedFoldersText, setSelectedFoldersText] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [preview, setPreview] = useState<WorkOpsPreviewResponse | null>(null);
  const [events, setEvents] = useState<WorkOpsProgressEvent[]>([]);
  const [status, setStatus] = useState<{ type: "idle" | "loading" | "error" | "ok"; msg?: string }>({ type: "idle" });
  const [processLoading, setProcessLoading] = useState(false);

  const selectedFolders = useMemo(
    () => selectedFoldersText.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
    [selectedFoldersText],
  );

  const handlePreview = async (): Promise<void> => {
    setStatus({ type: "loading", msg: "Loading preview..." });
    setEvents([]);
    try {
      const result = await previewWorkOps({
        source_path: sourcePath.trim(),
        target_format: targetFormat,
        output_base_path: outputBasePath.trim() || undefined,
        multi_folder: multiFolder,
      });
      setPreview(result);
      setStatus({ type: result.success ? "ok" : "error", msg: result.message });
    } catch (err) {
      setPreview(null);
      setStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleProcess = async (forceOverwrite = false): Promise<void> => {
    setProcessLoading(true);
    setStatus({ type: "loading", msg: "Processing..." });
    try {
      const result = await runWorkOpsProcess({
        source_path: sourcePath.trim(),
        target_format: targetFormat,
        keep_source: keepSource,
        threads: Number(threads),
        output_base_path: outputBasePath.trim(),
        force_overwrite: forceOverwrite,
        multi_folder: multiFolder,
        selected_folders: multiFolder ? selectedFolders : undefined,
        cover_image: coverImage.trim() || undefined,
      });
      setEvents(result.events);
      const lastMessage = result.last_event?.message ?? (result.success ? "Done" : result.error ?? "Failed");
      setStatus({ type: result.success ? "ok" : "error", msg: lastMessage });
    } catch (err) {
      setEvents([]);
      setStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setProcessLoading(false);
    }
  };

  const latestEvent = events.at(-1) ?? null;
  const needsOverwriteConfirm = latestEvent?.step === "confirm_overwrite";

  return (
    <div className="dark min-h-screen bg-black p-6 text-zinc-100">
      <PageHeaderNav />
      <h1 className="mb-5 text-2xl font-bold text-zinc-100">Work Operations</h1>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/30">
          <h2 className="mb-4 text-base font-semibold text-zinc-100">Operation Settings</h2>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Source Path</label>
              <Input className="border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500" value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="/path/to/RJ folder" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Output Base Path</label>
              <Input className="border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500" value={outputBasePath} onChange={(e) => setOutputBasePath(e.target.value)} placeholder="Optional output base path" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Target Format</label>
                <Select value={targetFormat} onValueChange={(value) => setTargetFormat(value as (typeof TARGET_FORMAT_OPTIONS)[number]["value"])}>
                  <SelectTrigger className="border-zinc-800 bg-zinc-900 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TARGET_FORMAT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Threads</label>
                <Select value={threads} onValueChange={(value) => setThreads(value as (typeof THREAD_OPTIONS)[number])}>
                  <SelectTrigger className="border-zinc-800 bg-zinc-900 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THREAD_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200">
                <input type="checkbox" checked={multiFolder} onChange={(e) => setMultiFolder(e.target.checked)} />
                <span>Multi Folder</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200">
                <input type="checkbox" checked={keepSource} onChange={(e) => setKeepSource(e.target.checked)} />
                <span>Keep Source</span>
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Cover Image</label>
              <Input className="border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500" value={coverImage} onChange={(e) => setCoverImage(e.target.value)} placeholder="Optional cover image filename" />
            </div>
            {multiFolder && (
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">Selected Folders</label>
                <Textarea
                  value={selectedFoldersText}
                  onChange={(e) => setSelectedFoldersText(e.target.value)}
                  placeholder={"One folder per line or comma separated"}
                  className="min-h-28 border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500"
                />
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void handlePreview()} disabled={!sourcePath.trim() || processLoading}>Preview</Button>
              <Button variant="outline" onClick={() => void handleProcess(false)} disabled={!sourcePath.trim() || processLoading}>Run</Button>
              {needsOverwriteConfirm && (
                <Button variant="destructive" onClick={() => void handleProcess(true)} disabled={processLoading}>Force Overwrite</Button>
              )}
            </div>
            <div className={`min-h-5 text-sm ${status.type === "error" ? "text-red-400" : status.type === "ok" ? "text-emerald-400" : "text-zinc-400"}`}>
              {status.type === "loading" ? "Loading..." : (status.msg ?? "")}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/30">
            <h2 className="mb-4 text-base font-semibold text-zinc-100">Preview Result</h2>
            {preview ? (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={preview.success ? "default" : "destructive"}>{preview.success ? "Ready" : "Failed"}</Badge>
                  {preview.rj_code && <Badge variant="secondary">{preview.rj_code}</Badge>}
                  {preview.cv_folder_name && <Badge variant="outline">{preview.cv_folder_name}</Badge>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Title</p>
                    <p>{preview.title ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">CV</p>
                    <p>{preview.cv ?? "-"}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-muted-foreground">Output Preview</p>
                    <p className="break-all">{preview.output_path_preview ?? "-"}</p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Audio Files</p>
                    <div className="space-y-1">
                      {preview.audio_files.length > 0 ? preview.audio_files.map((file) => (
                        <div key={file.filename} className="rounded-md border border-border px-3 py-2">
                          <p>{file.filename}</p>
                          <p className="text-xs text-muted-foreground">{file.format} · {file.size_mb} MB</p>
                        </div>
                      )) : <p className="text-muted-foreground">No root audio files</p>}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Images</p>
                    <div className="flex flex-wrap gap-2">
                      {preview.image_files.length > 0 ? preview.image_files.map((item) => (
                        <Badge key={item} variant={item === preview.cover_image ? "default" : "secondary"}>{item}</Badge>
                      )) : <span className="text-muted-foreground">No images</span>}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Other Items</p>
                    <div className="flex flex-wrap gap-2">
                      {preview.other_items.length > 0 ? preview.other_items.map((item) => (
                        <Badge key={item} variant="outline">{item}</Badge>
                      )) : <span className="text-muted-foreground">No extra items</span>}
                    </div>
                  </div>
                </div>
                {preview.sub_folders.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Sub Folders</p>
                    <div className="space-y-2">
                      {preview.sub_folders.map((folder) => (
                        <div key={folder.name} className="rounded-lg border border-border p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="font-medium">{folder.name}</p>
                            <Badge variant="outline">{folder.audio_files.length} audio</Badge>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {folder.audio_files.map((file) => (
                              <Badge key={`${folder.name}-${file.filename}`} variant="secondary">{file.filename}</Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Run preview to inspect audio, image and output path information.</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/30">
            <h2 className="mb-4 text-base font-semibold text-zinc-100">Process Events</h2>
            <div className="space-y-2">
              {events.length > 0 ? events.map((event, index) => (
                <div key={`${event.step}-${index}`} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="outline">{event.step}</Badge>
                    {typeof event.progress === "number" && typeof event.total === "number" && (
                      <span className="text-xs text-muted-foreground">{event.progress}/{event.total}</span>
                    )}
                  </div>
                  <p className={`mt-2 ${getEventTone(event.step)}`}>{event.message}</p>
                  {event.output_path && <p className="mt-1 break-all text-xs text-muted-foreground">{event.output_path}</p>}
                  {event.errors && event.errors.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs text-destructive">
                      {event.errors.map((item) => <p key={item}>{item}</p>)}
                    </div>
                  )}
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No events yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
