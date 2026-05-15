import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWorksList, updateWorkStatus } from "@/lib/api";
import type { DownloadLinksValue, WorkItem, WorksQueryPreset } from "@/types";
import { PageHeaderNav } from "@/components/page-header-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  Link2,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";

const PAGE_SIZE_OPTIONS = ["5", "10", "20", "30", "50", "100"];
const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "0", label: "Not Downloaded" },
  { value: "1", label: "Downloaded" },
  { value: "2", label: "Deleted" },
] as const;
const STATUS_EDIT_OPTIONS = [
  { value: "0", label: "Not Downloaded" },
  { value: "1", label: "Downloaded" },
  { value: "2", label: "Deleted" },
] as const;
const SOURCE_OPTIONS = [
  { value: "all", label: "All Sources" },
  { value: "asmrone", label: "asmrone" },
  { value: "mega", label: "mega" },
] as const;
const PRESET_OPTIONS: Array<{ value: WorksQueryPreset; label: string }> = [
  { value: "all", label: "None" },
  { value: "latest-undownloaded", label: "Latest Undownloaded" },
  { value: "latest-added", label: "Latest Added" },
];

type ModalType = "detail" | "download-links" | null;

interface ModalState {
  type: ModalType;
  item: WorkItem | null;
}

function getInitialParams() {
  const p = new URLSearchParams(location.search);
  const preset = p.get("preset");
  return {
    preset:
      preset === "latest-added" || preset === "latest-undownloaded" || preset === "all"
        ? preset
        : "all",
    page_size: p.get("page_size") ?? "30",
    circle: p.get("circle") ?? "",
    rj_code: p.get("rj_code") ?? "",
    title: p.get("title") ?? "",
    source: p.get("source") ?? "all",
    status: p.get("status") ?? "all",
  } as {
    preset: WorksQueryPreset;
    page_size: string;
    circle: string;
    rj_code: string;
    title: string;
    source: string;
    status: string;
  };
}

function statusLabel(status?: number): string {
  if (status === 1) return "Downloaded";
  if (status === 2) return "Deleted";
  return "Not Downloaded";
}

function statusVariant(status?: number): "default" | "secondary" | "outline" {
  if (status === 1) return "default";
  if (status === 2) return "secondary";
  return "outline";
}

function formatJson(value: DownloadLinksValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function downloadLinksSummary(value: DownloadLinksValue): string {
  if (value == null) return "None";
  if (typeof value === "string") return value.trim() ? "Raw Text" : "None";
  if (Array.isArray(value)) return `${value.length} items`;
  return `${Object.keys(value).length} items`;
}

export default function WorksPage() {
  const init = getInitialParams();
  const [preset, setPreset] = useState<WorksQueryPreset>(init.preset);
  const [pageSize, setPageSize] = useState(init.page_size);
  const [circle, setCircle] = useState(init.circle);
  const [rjCode, setRjCode] = useState(init.rj_code);
  const [title, setTitle] = useState(init.title);
  const [source, setSource] = useState(init.source);
  const [statusFilter, setStatusFilter] = useState(init.status);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "error" | "ok";
    msg?: string;
  }>({ type: "idle" });
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<ModalState>({ type: null, item: null });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (modal.type) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [modal.type]);

  const currentFilters = useMemo(
    () => ({ preset, circle, rj_code: rjCode, title, source, status: statusFilter }),
    [preset, circle, rjCode, title, source, statusFilter],
  );

  const load = useCallback(
    async (
      p: number,
      ps: string,
      filters: {
        preset: WorksQueryPreset;
        circle: string;
        rj_code: string;
        title: string;
        source: string;
        status: string;
      },
    ) => {
      setStatus({ type: "loading" });
      const q = new URLSearchParams({
        page: String(p),
        page_size: ps,
      });
      if (filters.preset !== "all") q.set("preset", filters.preset);
      if (filters.circle.trim()) q.set("circle", filters.circle.trim());
      if (filters.rj_code.trim()) q.set("rj_code", filters.rj_code.trim());
      if (filters.title.trim()) q.set("title", filters.title.trim());
      if (filters.source !== "all") q.set("source", filters.source);
      if (filters.status !== "all") q.set("status", filters.status);
      history.replaceState(null, "", "/works?" + q.toString());
      try {
        const data = await fetchWorksList({
          preset: filters.preset,
          page: p,
          page_size: Number(ps),
          circle: filters.circle.trim() || undefined,
          rj_code: filters.rj_code.trim() || undefined,
          title: filters.title.trim() || undefined,
          source: filters.source === "all" ? undefined : filters.source,
          status: filters.status === "all" ? undefined : Number(filters.status),
        });
        setTotal(data.total);
        setItems(data.data);
        setStatus({ type: "ok", msg: `Total ${data.total}` });
      } catch (err) {
        setStatus({
          type: "error",
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  useEffect(() => {
    void load(page, pageSize, currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSearch = (nextPage = 1) => {
    setPage(nextPage);
    void load(nextPage, pageSize, currentFilters);
  };

  const debouncedSearch = (nextFilters: Partial<typeof currentFilters> = {}) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const merged = { ...currentFilters, ...nextFilters };
      setPage(1);
      void load(1, pageSize, merged);
    }, 300);
  };

  const handleReset = () => {
    setPreset("all");
    setPageSize("30");
    setCircle("");
    setRjCode("");
    setTitle("");
    setSource("all");
    setStatusFilter("all");
    setPage(1);
    void load(1, "30", {
      preset: "all",
      circle: "",
      rj_code: "",
      title: "",
      source: "all",
      status: "all",
    });
  };

  const closeModal = () => setModal({ type: null, item: null });

  const handleUpdateWorkStatus = async (item: WorkItem, nextStatusValue: string) => {
    const nextStatus = Number(nextStatusValue);
    if (Number.isNaN(nextStatus) || item.status === nextStatus) return;

    setActionLoading((prev) => ({ ...prev, [item.rj_code]: true }));
    try {
      const result = await updateWorkStatus(item.rj_code, nextStatus);
      setStatus({ type: "ok", msg: result.message ?? `Updated ${item.rj_code}` });
      await load(page, pageSize, currentFilters);
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [item.rj_code]: false }));
    }
  };

  const handleRemoveWork = async (item: WorkItem) => {
    if (!confirm(`Delete work \"${item.rj_code}\"?`)) return;
    setActionLoading((prev) => ({ ...prev, [item.rj_code]: true }));
    try {
      await fetch("/api/works/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rj_code: item.rj_code }),
      }).then(async (res) => {
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "操作失败");
      });
      setStatus({ type: "ok", msg: `Deleted ${item.rj_code}` });
      void load(page, pageSize, currentFilters);
      closeModal();
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [item.rj_code]: false }));
    }
  };


  const pages = Math.max(1, Math.ceil(total / Number(pageSize)));
  const modalItem = modal.item;
  const modalDownloadLinksText = modalItem ? formatJson(modalItem.download_links) : "";

  return (
    <div className="min-h-screen bg-background p-6">
      <PageHeaderNav />
      <h1 className="mb-5 text-2xl font-bold text-foreground">Works Management</h1>
      <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7 mb-4 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Preset</label>
            <Select
              value={preset}
              onValueChange={(value) => {
                const nextPreset = value as WorksQueryPreset;
                setPreset(nextPreset);
                setPage(1);
                void load(1, pageSize, { ...currentFilters, preset: nextPreset });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Circle</label>
            <Input
              placeholder="Search circle"
              value={circle}
              onChange={(e) => {
                const value = e.target.value;
                setCircle(value);
                debouncedSearch({ circle: value });
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">RJ Code</label>
            <Input
              placeholder="Enter RJ code"
              value={rjCode}
              onChange={(e) => {
                const value = e.target.value;
                setRjCode(value);
                debouncedSearch({ rj_code: value });
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Title</label>
            <Input
              placeholder="Search title"
              value={title}
              onChange={(e) => {
                const value = e.target.value;
                setTitle(value);
                debouncedSearch({ title: value });
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Source</label>
            <Select
              value={source}
              onValueChange={(value) => {
                setSource(value);
                setPage(1);
                void load(1, pageSize, { ...currentFilters, source: value });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
                void load(1, pageSize, { ...currentFilters, status: value });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Per Page</label>
            <Select
              value={pageSize}
              onValueChange={(value) => {
                setPageSize(value);
                setPage(1);
                void load(1, value, currentFilters);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => triggerSearch(1)}>
            <Search className="mr-1.5 h-4 w-4" />Search
          </Button>
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="mr-1.5 h-4 w-4" />Reset
          </Button>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <span className={`text-sm ${status.type === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {status.type === "loading" ? "Loading..." : (status.msg ?? "")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetails((value) => !value)}
          >
            {showDetails ? (
              <><ChevronUp className="mr-1.5 h-4 w-4" />Hide Details</>
            ) : (
              <><ChevronDown className="mr-1.5 h-4 w-4" />Show Details</>
            )}
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RJ Code</TableHead>
                {showDetails && <TableHead className="w-20">Cover</TableHead>}
                <TableHead>Title</TableHead>
                <TableHead>Circle</TableHead>
                <TableHead>Status</TableHead>
                {showDetails && <TableHead>Source</TableHead>}
                {showDetails && <TableHead>Created At</TableHead>}
                <TableHead>Download Links</TableHead>
                <TableHead className="sticky right-0 w-40 bg-card">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.rj_code}>
                  <TableCell className="font-medium">
                    {item.title_url ? (
                      <a
                        href={item.title_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {item.rj_code}
                      </a>
                    ) : (
                      item.rj_code
                    )}
                  </TableCell>
                  {showDetails && (
                    <TableCell>
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt={item.rj_code}
                          className="h-14 w-14 rounded-md bg-muted object-cover"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-md bg-muted" />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="max-w-xs text-sm">
                    {item.title_url ? (
                      <a
                        href={item.title_url}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-primary hover:underline"
                      >
                        {item.title ?? "-"}
                      </a>
                    ) : (
                      <span className="line-clamp-2">{item.title ?? "-"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.circle_url ? (
                      <a
                        href={item.circle_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        {item.circle ?? "-"}
                      </a>
                    ) : (
                      item.circle ?? <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={String(item.status ?? 0)}
                      disabled={actionLoading[item.rj_code]}
                      onValueChange={(value) => void handleUpdateWorkStatus(item, value)}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_EDIT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  {showDetails && (
                    <TableCell className="text-sm text-muted-foreground">
                      {item.source ?? "-"}
                    </TableCell>
                  )}
                  {showDetails && (
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {item.created_at ?? "-"}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setModal({ type: "download-links", item })}
                    >
                      <Link2 className="mr-1 h-3.5 w-3.5" />
                      {downloadLinksSummary(item.download_links)}
                    </Button>
                  </TableCell>
                  <TableCell className="sticky right-0 bg-card">
                    <div className="flex flex-col gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setModal({ type: "detail", item })}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" />View Details
                      </Button>
                      {item.title_url && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={item.title_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />Open Link
                          </a>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={actionLoading[item.rj_code]}
                        onClick={() => void handleRemoveWork(item)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />Delete Work
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && status.type !== "loading" && (
                <TableRow>
                  <TableCell
                    colSpan={showDetails ? 8 : 6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    No data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 text-sm text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage((value) => value - 1);
              void load(page - 1, pageSize, currentFilters);
            }}
          >
            Previous
          </Button>
          <span>{page} / {pages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => {
              setPage((value) => value + 1);
              void load(page + 1, pageSize, currentFilters);
            }}
          >
            Next
          </Button>
        </div>
      </div>

      {modal.type && modalItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="flex max-h-[85vh] w-auto min-w-[min(90vw,560px)] max-w-[90vw] flex-col rounded-2xl border border-border bg-card shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)] animate-in fade-in-0 zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative shrink-0 overflow-hidden rounded-t-2xl border-b border-border px-6 py-5">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent" />
              <div className="relative flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-card-foreground">
                    {modal.type === "detail" ? "Work Details" : "Download Links"}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{modalItem.rj_code}</p>
                </div>
                <button
                  onClick={closeModal}
                  className="relative z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {modal.type === "detail" && (
                <div className="space-y-5">
                  <div className="flex gap-4">
                    {modalItem.thumbnail ? (
                      <img
                        src={modalItem.thumbnail}
                        alt={modalItem.rj_code}
                        className="h-28 w-28 rounded-lg bg-muted object-cover"
                      />
                    ) : (
                      <div className="h-28 w-28 rounded-lg bg-muted" />
                    )}
                    <div className="flex-1 space-y-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Title</p>
                        {modalItem.title_url ? (
                          <a
                            href={modalItem.title_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {modalItem.title ?? "-"}
                          </a>
                        ) : (
                          <p className="text-sm text-card-foreground">{modalItem.title ?? "-"}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">RJ Code</p>
                          <p>{modalItem.rj_code}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Status</p>
                          <Badge variant={statusVariant(modalItem.status)}>{statusLabel(modalItem.status)}</Badge>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Circle</p>
                          {modalItem.circle_url ? (
                            <a
                              href={modalItem.circle_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {modalItem.circle ?? "-"}
                            </a>
                          ) : (
                            <p>{modalItem.circle ?? "-"}</p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">CV</p>
                          <p>{modalItem.cv ?? "-"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Release Date</p>
                          <p>{modalItem.release_date ?? "-"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Source</p>
                          <p>{modalItem.source ?? "-"}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs text-muted-foreground">Created At</p>
                          <p>{modalItem.created_at ?? "-"}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {modalItem.tags.length > 0 ? (
                        modalItem.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">{tag}</Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No tags</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {modal.type === "download-links" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                      {modalItem.download_links == null ? "No download links for this work." : "You can copy the content below."}
                    </span>
                    {modalItem.download_links != null && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void navigator.clipboard.writeText(modalDownloadLinksText)}
                      >
                        Copy
                      </Button>
                    )}
                  </div>
                  {modalItem.download_links == null ? (
                    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                      No download links
                    </div>
                  ) : (
                    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-4 text-xs leading-6 text-card-foreground whitespace-pre-wrap break-all">
                      {modalDownloadLinksText}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
