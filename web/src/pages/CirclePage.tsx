import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchCircleList,
  fetchCircleWorks,
  fetchCircleLatestWorks,
  postJson,
  addCircle,
} from "@/lib/api";
import type {
  CircleItem,
  CircleDetail,
  CircleWork,
  CircleLatestWork,
} from "@/types";
import { PageHeaderNav } from "@/components/page-header-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Save,
  Minus,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  Pencil,
  Trash2,
  Plus,
  Check,
} from "lucide-react";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];
const DETAIL_TOGGLE_LABELS = {
  show: "Show Details",
  hide: "Hide Details",
} as const;

function getInitialParams() {
  const p = new URLSearchParams(location.search);
  return {
    page_size: p.get("page_size") ?? "20",
    name: p.get("name") ?? "",
    nickname: p.get("nickname") ?? "",
    remark: p.get("remark") ?? "",
  };
}

type ModalType = "latest-works" | "db-works" | "edit" | "create" | null;

interface ModalState {
  type: ModalType;
  circleName: string;
}

export default function CirclePage() {
  const init = getInitialParams();
  const [pageSize, setPageSize] = useState(init.page_size);
  const [name, setName] = useState(init.name);
  const [nickname, setNickname] = useState(init.nickname);
  const [remark, setRemark] = useState(init.remark);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [circles, setCircles] = useState<CircleItem[]>([]);
  const [createName, setCreateName] = useState("");
  const [createNickname, setCreateNickname] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createRemark, setCreateRemark] = useState("");
  const [createStatus, setCreateStatus] = useState<{
    type: "idle" | "loading" | "error" | "ok";
    msg?: string;
  }>({ type: "idle" });
  const [listStatus, setListStatus] = useState<{
    type: "idle" | "loading" | "error" | "ok";
    msg?: string;
  }>({ type: "idle" });

  const [modal, setModal] = useState<ModalState>({
    type: null,
    circleName: "",
  });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (modal.type) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [modal.type]);

  // edit modal state
  const [editDetail, setEditDetail] = useState<CircleDetail | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const [editStatus, setEditStatus] = useState<{
    type: "idle" | "loading" | "error" | "ok";
    msg?: string;
  }>({ type: "idle" });

  // db-works modal state
  const [worksPage, setWorksPage] = useState(1);
  const [worksPageSize] = useState("20");
  const [worksRjCode, setWorksRjCode] = useState("");
  const [worksTitle, setWorksTitle] = useState("");
  const [worksTotal, setWorksTotal] = useState(0);
  const [works, setWorks] = useState<CircleWork[]>([]);
  const [worksStatus, setWorksStatus] = useState<{
    type: "idle" | "loading" | "error" | "ok";
    msg?: string;
  }>({ type: "idle" });
  // latest-works modal state
  const [latestWorks, setLatestWorks] = useState<CircleLatestWork[]>([]);
  const [latestStatus, setLatestStatus] = useState<{
    type: "idle" | "loading" | "error" | "ok";
    msg?: string;
  }>({ type: "idle" });
  const [latestExistsMap, setLatestExistsMap] = useState<
    Record<string, boolean>
  >({});
  const [addingRj, setAddingRj] = useState<Record<string, boolean>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCircles = useCallback(
    async (
      p: number,
      ps: string,
      filters: { name: string; nickname: string; remark: string },
    ) => {
      setListStatus({ type: "loading" });
      const q = new URLSearchParams({ page: String(p), page_size: ps });
      if (filters.name.trim()) q.set("name", filters.name.trim());
      if (filters.nickname.trim()) q.set("nickname", filters.nickname.trim());
      if (filters.remark.trim()) q.set("remark", filters.remark.trim());
      history.replaceState(null, "", "/circle?" + q.toString());
      try {
        const trimmed = Object.fromEntries(
          Object.entries(filters)
            .filter(([, v]) => v.trim())
            .map(([k, v]) => [k, v.trim()]),
        ) as { name?: string; nickname?: string; remark?: string };
        const data = await fetchCircleList({
          page: p,
          page_size: Number(ps),
          ...trimmed,
        });
        setTotal(data.total);
        setCircles(data.data);
        setListStatus({ type: "ok", msg: `Total ${data.total}` });
      } catch (err) {
        setListStatus({
          type: "error",
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  const loadWorks = useCallback(
    async (
      circleName: string,
      p: number,
      ps: string,
      rj: string,
      t: string,
    ) => {
      setWorksStatus({ type: "loading" });
      try {
        const data = await fetchCircleWorks({
          circle_name: circleName,
          page: p,
          page_size: Number(ps),
          rj_code: rj.trim() || undefined,
          title: t.trim() || undefined,
        });
        setWorksTotal(data.total);
        setWorks(data.data);
        setWorksStatus({ type: "ok", msg: `Total ${data.total}` });
      } catch (err) {
        setWorksStatus({
          type: "error",
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  const currentFilters = { name, nickname, remark };

  useEffect(() => {
    void loadCircles(page, pageSize, currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openLatestWorks = async (circleName: string) => {
    setModal({ type: "latest-works", circleName });
    setLatestStatus({ type: "loading" });
    setLatestWorks([]);
    setLatestExistsMap({});
    setAddingRj({});
    try {
      const data = await fetchCircleLatestWorks(circleName, 20);
      setLatestWorks(data.items);
      setLatestStatus({ type: "ok", msg: `Total ${data.items.length}` });
      if (data.items.length > 0) {
        const codes = data.items.map((w) => w.rj_code);
        const res = await postJson<{ exists: Record<string, boolean> }>(
          "/api/rj/check",
          { rj_codes: codes },
        );
        setLatestExistsMap(res.exists ?? {});
      }
    } catch (err) {
      setLatestStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const openDbWorks = (circleName: string) => {
    setModal({ type: "db-works", circleName });
    setWorksPage(1);
    setWorksRjCode("");
    setWorksTitle("");
    void loadWorks(circleName, 1, worksPageSize, "", "");
  };

  const openEdit = async (circleName: string) => {
    setModal({ type: "edit", circleName });
    setEditStatus({ type: "loading" });
    setEditDetail(null);
    try {
      const q = new URLSearchParams({ name: circleName });
      const res = await fetch(`/api/circle/detail?${q}`);
      const d = (await res.json()) as CircleDetail & { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Load failed");
      setEditDetail(d);
      setEditNickname(d.nickname ?? "");
      setEditUrl(d.circle_url ?? "");
      setEditRemark(d.remark ?? "");
      setEditStatus({ type: "ok" });
    } catch (err) {
      setEditStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const closeModal = () => setModal({ type: null, circleName: "" });

  const handleCreateCircle = async () => {
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateStatus({ type: "error", msg: "Circle name is required" });
      return;
    }

    setCreateStatus({ type: "loading", msg: "Creating..." });
    try {
      const result = await addCircle({
        name: trimmedName,
        nickname: createNickname.trim() || undefined,
        circle_url: createUrl.trim() || undefined,
        remark: createRemark.trim() || undefined,
      });
      setCreateStatus({
        type: result.added ? "ok" : "error",
        msg: result.added
          ? `Added ${result.name}`
          : result.exists
            ? `${result.name} already exists`
            : `Failed to add ${result.name}`,
      });
      if (!result.added) return;
      setCreateName("");
      setCreateNickname("");
      setCreateUrl("");
      setCreateRemark("");
      setPage(1);
      await loadCircles(1, pageSize, currentFilters);
    } catch (err) {
      setCreateStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleUpdateCircle = async () => {
    if (!modal.circleName) return;
    setEditStatus({ type: "loading" });
    try {
      await postJson("/api/circle/update", {
        name: modal.circleName,
        nickname: editNickname.trim() || null,
        circle_url: editUrl.trim() || null,
        remark: editRemark.trim() || null,
      });
      setEditStatus({ type: "ok", msg: "Saved" });
      void loadCircles(page, pageSize, currentFilters);
    } catch (err) {
      setEditStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDeleteCircle = async (circleName: string) => {
    if (!confirm(`Delete circle \"${circleName}\"?`)) return;
    try {
      await postJson("/api/circle/remove", { name: circleName });
      void loadCircles(page, pageSize, currentFilters);
    } catch (err) {
      setListStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleRemoveWork = async (rjCode: string) => {
    if (!modal.circleName) return;
    try {
      await postJson("/api/circle/work/remove", {
        circle_name: modal.circleName,
        rj_code: rjCode,
      });
      void loadWorks(
        modal.circleName,
        worksPage,
        worksPageSize,
        worksRjCode,
        worksTitle,
      );
    } catch (err) {
      setWorksStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleAddLatestWork = async (w: CircleLatestWork) => {
    if (!modal.circleName) return;
    setAddingRj((prev) => ({ ...prev, [w.rj_code]: true }));
    try {
      await postJson("/api/circle/latest-works/add", {
        rj_code: w.rj_code,
        title: w.title,
        title_url: w.title_url,
        thumbnail: w.thumbnail,
        release_date: w.release_date,
        is_all_ages: w.is_all_ages,
        circle_name: modal.circleName,
      });
      setLatestExistsMap((prev) => ({ ...prev, [w.rj_code]: true }));
    } catch (err) {
      setLatestStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAddingRj((prev) => ({ ...prev, [w.rj_code]: false }));
    }
  };

  const debouncedSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      void loadCircles(1, pageSize, currentFilters);
    }, 300);
  };

  const worksPages = Math.max(1, Math.ceil(worksTotal / Number(worksPageSize)));
  const pages = Math.max(1, Math.ceil(total / Number(pageSize)));

  return (
    <div className="min-h-screen bg-background p-6">
      <PageHeaderNav />
      <h1 className="text-2xl font-bold mb-5 text-foreground">Circle Management</h1>

      {/* Circle list */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold mb-4 text-card-foreground">
          Circle List
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Circle Name</label>
            <Input
              placeholder="Search"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                debouncedSearch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Alias</label>
            <Input
              placeholder="Search"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                debouncedSearch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Remark</label>
            <Input
              placeholder="Search"
              value={remark}
              onChange={(e) => {
                setRemark(e.target.value);
                debouncedSearch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Per Page</label>
            <Select
              value={pageSize}
              onValueChange={(v) => {
                setPageSize(v);
                setPage(1);
                void loadCircles(1, v, currentFilters);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => {
              setPage(1);
              void loadCircles(1, pageSize, currentFilters);
            }}
          >
            <Search className="w-4 h-4 mr-1.5" />
            Search
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setCreateStatus({ type: "idle" });
              setModal({ type: "create", circleName: "" });
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Add Circle
          </Button>
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground h-5">
            {listStatus.type === "loading" ? (
              "Loading..."
            ) : listStatus.type === "error" ? (
              <span className="text-destructive">{listStatus.msg}</span>
            ) : (
              listStatus.msg
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? (
              <><ChevronUp className="w-4 h-4 mr-1.5" />{DETAIL_TOGGLE_LABELS.hide}</>
            ) : (
              <><ChevronDown className="w-4 h-4 mr-1.5" />{DETAIL_TOGGLE_LABELS.show}</>
            )}
          </Button>
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Circle Name</TableHead>
                <TableHead>Alias</TableHead>
                <TableHead className="w-16">RJ Count</TableHead>
                <TableHead>Remark</TableHead>
                <TableHead className="w-64 text-right sticky right-0 bg-card">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {circles.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.nickname ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.rj_count ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">
                    {c.remark ?? "-"}
                  </TableCell>
                  <TableCell className="text-right sticky right-0 bg-card">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openLatestWorks(c.name)}
                      >
                        <Clock className="w-3.5 h-3.5 mr-1" />
                        Latest Works
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDbWorks(c.name)}
                      >
                        <Database className="w-3.5 h-3.5 mr-1" />
                        DB Works
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openEdit(c.name)}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        Edit Circle
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDeleteCircle(c.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {circles.length === 0 && listStatus.type !== "loading" && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-end gap-3 mt-3 text-sm text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
              void loadCircles(page - 1, pageSize, currentFilters);
            }}
          >
            Previous
          </Button>
          <span>
            {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => {
              setPage((p) => p + 1);
              void loadCircles(page + 1, pageSize, currentFilters);
            }}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Modal backdrop */}
      {modal.type && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="bg-card rounded-2xl border border-border shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)] w-auto min-w-[min(90vw,480px)] max-w-[90vw] max-h-[85vh] flex flex-col animate-in fade-in-0 zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="relative flex items-center justify-between px-6 py-5 border-b border-border shrink-0 overflow-hidden rounded-t-2xl">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
              <div className="relative">
                <h2 className="text-base font-semibold text-card-foreground">
                  {modal.type === "latest-works" && "Latest Works"}
                  {modal.type === "db-works" && "DB Works"}
                  {modal.type === "edit" && "Edit Circle"}
                  {modal.type === "create" && "Add Circle"}
                </h2>
                  {modal.type === "create" && (
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      Create a new circle record
                    </p>
                  )}
                  {modal.type !== "create" && (
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {modal.circleName}
                    </p>
                  )}
              </div>
              <button
                onClick={closeModal}
                className="relative z-10 flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto flex-1 p-6">
              {modal.type === "create" && (
                <div className="flex flex-col gap-4 max-w-md">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">
                      Circle Name
                    </label>
                    <Input
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="Required"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">
                      Alias
                    </label>
                    <Input
                      value={createNickname}
                      onChange={(e) => setCreateNickname(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">
                      Circle URL
                    </label>
                    <Input
                      value={createUrl}
                      onChange={(e) => setCreateUrl(e.target.value)}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">
                      Remark
                    </label>
                    <Textarea
                      value={createRemark}
                      onChange={(e) => setCreateRemark(e.target.value)}
                      placeholder="Optional remark"
                      rows={3}
                    />
                  </div>
                  <p className={`text-sm ${createStatus.type === "error" ? "text-destructive" : createStatus.type === "ok" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                    {createStatus.type === "loading" ? "Creating..." : (createStatus.msg ?? "Fill the form and create a new circle.")}
                  </p>
                  <Button
                    onClick={() => void handleCreateCircle()}
                    disabled={createStatus.type === "loading"}
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add Circle
                  </Button>
                </div>
              )}

              {/* Latest works */}
              {modal.type === "latest-works" && (
                <div>
                  <div className="text-sm text-muted-foreground mb-3 h-5">
                    {latestStatus.type === "loading" ? (
                      "Loading..."
                    ) : latestStatus.type === "error" ? (
                      <span className="text-destructive">
                        {latestStatus.msg}
                      </span>
                    ) : (
                      latestStatus.msg
                    )}
                  </div>
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {showDetails && <TableHead className="w-20">Cover</TableHead>}
                          <TableHead>RJ Code</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>CV</TableHead>
                          {showDetails && <TableHead>Tags</TableHead>}
                          {showDetails && <TableHead className="w-28">Rating</TableHead>}
                          <TableHead className="w-24 sticky right-0 bg-card">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {latestStatus.type !== "loading" &&
                          latestWorks.map((w) => (
                            <TableRow key={w.rj_code}>
                              {showDetails && (
                                <TableCell>
                                  {w.thumbnail ? (
                                    <img
                                      src={w.thumbnail}
                                      alt={w.rj_code}
                                      className="w-14 h-14 object-cover rounded-md bg-muted"
                                    />
                                  ) : (
                                    <div className="w-14 h-14 rounded-md bg-muted" />
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="font-medium">
                                {w.title_url ? (
                                  <a
                                    href={w.title_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline"
                                  >
                                    {w.rj_code}
                                  </a>
                                ) : (
                                  w.rj_code
                                )}
                              </TableCell>
                              <TableCell className="max-w-xs text-sm">
                                {w.title_url ? (
                                  <a
                                    href={w.title_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline line-clamp-2"
                                  >
                                    {w.title}
                                  </a>
                                ) : (
                                  <span className="line-clamp-2">
                                    {w.title}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-sm">
                                {w.cv ?? "-"}
                              </TableCell>
                              {showDetails && (
                                <TableCell>
                                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                                    {w.tags.map((t) => (
                                      <Badge key={t} variant="secondary">
                                        {t}
                                      </Badge>
                                    ))}
                                  </div>
                                </TableCell>
                              )}
                              {showDetails && (
                                <TableCell>
                                  <Badge
                                    variant={
                                      w.is_all_ages ? "secondary" : "outline"
                                    }
                                  >
                                    {w.is_all_ages ? "All Ages" : "R18"}
                                  </Badge>
                                </TableCell>
                              )}
                              <TableCell className="sticky right-0 bg-card">
                                {latestExistsMap[w.rj_code] ? (
                                  <Button size="sm" variant="outline" disabled>
                                    <Check className="w-3.5 h-3.5 mr-1" />
                                    Added
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={addingRj[w.rj_code]}
                                    onClick={() => void handleAddLatestWork(w)}
                                  >
                                    <Plus className="w-3.5 h-3.5 mr-1" />
                                    {addingRj[w.rj_code] ? "Adding..." : "Add"}
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        {latestStatus.type !== "loading" &&
                          latestWorks.length === 0 && (
                            <TableRow>
                              <TableCell
                                colSpan={showDetails ? 7 : 4}
                                className="text-center text-muted-foreground py-8"
                              >
                                No works
                              </TableCell>
                            </TableRow>
                          )}
                        {latestStatus.type === "loading" && (
                          <TableRow>
                            <TableCell
                              colSpan={showDetails ? 7 : 2}
                              className="text-center text-muted-foreground py-8"
                            >
                              Loading...
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* DB works */}
              {modal.type === "db-works" && (
                <div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted-foreground">
                        RJ Code
                      </label>
                      <Input
                        placeholder="Filter"
                        value={worksRjCode}
                        onChange={(e) => {
                          setWorksRjCode(e.target.value);
                          void loadWorks(
                            modal.circleName,
                            1,
                            worksPageSize,
                            e.target.value,
                            worksTitle,
                          );
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted-foreground">
                        Title
                      </label>
                      <Input
                        placeholder="Filter"
                        value={worksTitle}
                        onChange={(e) => {
                          setWorksTitle(e.target.value);
                          void loadWorks(
                            modal.circleName,
                            1,
                            worksPageSize,
                            worksRjCode,
                            e.target.value,
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className={`text-sm h-5 ${worksStatus.type === "error" ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {worksStatus.type === "loading"
                        ? "Loading..."
                        : (worksStatus.msg ?? "")}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>RJ Code</TableHead>
                          {showDetails && (
                            <TableHead className="w-20">Cover</TableHead>
                          )}
                          <TableHead>Title</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Release Date</TableHead>
                          {showDetails && <TableHead>Tags</TableHead>}
                          {showDetails && <TableHead>Source</TableHead>}
                          {showDetails && <TableHead>Added At</TableHead>}
                          <TableHead className="w-20 sticky right-0 bg-card">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {works.map((w) => (
                          <TableRow key={w.rj_code}>
                            <TableCell className="font-medium">
                              {w.title_url ? (
                                <a
                                  href={w.title_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline"
                                >
                                  {w.rj_code}
                                </a>
                              ) : (
                                w.rj_code
                              )}
                            </TableCell>
                            {showDetails && (
                              <TableCell>
                                {w.thumbnail ? (
                                  <img
                                    src={w.thumbnail}
                                    alt={w.rj_code}
                                    className="w-14 h-14 object-cover rounded-md bg-muted"
                                  />
                                ) : (
                                  <div className="w-14 h-14 rounded-md bg-muted" />
                                )}
                              </TableCell>
                            )}
                            <TableCell className="max-w-xs text-sm">
                              {w.title_url ? (
                                <a
                                  href={w.title_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline line-clamp-2"
                                >
                                  {w.title ?? "-"}
                                </a>
                              ) : (
                                <span className="line-clamp-2">
                                  {w.title ?? "-"}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  w.status === 1
                                    ? "default"
                                    : w.status === 2
                                      ? "secondary"
                                      : "outline"
                                }
                              >
                                {w.status === 1
                                  ? "Downloaded"
                                  : w.status === 2
                                    ? "Deleted"
                                    : "Not Downloaded"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {w.release_date ?? "-"}
                            </TableCell>
                            {showDetails && (
                              <TableCell className="text-sm max-w-[160px]">
                                <div className="flex flex-wrap gap-1">
                                  {w.tags.slice(0, 4).map((t) => (
                                    <Badge
                                      key={t}
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {t}
                                    </Badge>
                                  ))}
                                  {w.tags.length > 4 && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      +{w.tags.length - 4}
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                            )}
                            {showDetails && (
                              <TableCell className="text-muted-foreground text-sm">
                                {w.source ?? "-"}
                              </TableCell>
                            )}
                            {showDetails && (
                              <TableCell className="text-muted-foreground text-sm">
                                {w.added_at ? w.added_at.slice(0, 10) : "-"}
                              </TableCell>
                            )}
                            <TableCell className="sticky right-0 bg-card">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => void handleRemoveWork(w.rj_code)}
                              >
                                <Minus className="w-3.5 h-3.5 mr-1" />
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {works.length === 0 &&
                          worksStatus.type !== "loading" && (
                            <TableRow>
                              <TableCell
                                colSpan={showDetails ? 9 : 5}
                                className="text-center text-muted-foreground py-8"
                              >
                                No works
                              </TableCell>
                            </TableRow>
                          )}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-end gap-3 mt-3 text-sm text-muted-foreground">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={worksPage <= 1}
                      onClick={() => {
                        setWorksPage((p) => p - 1);
                        void loadWorks(
                          modal.circleName,
                          worksPage - 1,
                          worksPageSize,
                          worksRjCode,
                          worksTitle,
                        );
                      }}
                    >
                      Previous
                    </Button>
                    <span>
                      {worksPage} / {worksPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={worksPage >= worksPages}
                      onClick={() => {
                        setWorksPage((p) => p + 1);
                        void loadWorks(
                          modal.circleName,
                          worksPage + 1,
                          worksPageSize,
                          worksRjCode,
                          worksTitle,
                        );
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}

              {/* Edit circle */}
              {modal.type === "edit" && (
                <div className="flex flex-col gap-4 max-w-md">
                  {editStatus.type === "error" && (
                    <p className="text-destructive text-sm">{editStatus.msg}</p>
                  )}
                  {editStatus.type === "ok" && editStatus.msg && (
                    <p
                      className="text-sm"
                      style={{ color: "oklch(0.696 0.17 162.48)" }}
                    >
                      {editStatus.msg}
                    </p>
                  )}
                  {editDetail && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-muted-foreground">
                          Alias
                        </label>
                        <Input
                          value={editNickname}
                          onChange={(e) => setEditNickname(e.target.value)}
                          placeholder="Alias (optional)"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-muted-foreground">
                          Circle URL
                        </label>
                        <Input
                          value={editUrl}
                          onChange={(e) => setEditUrl(e.target.value)}
                          placeholder="https://..."
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-muted-foreground">
                          Remark
                        </label>
                        <Textarea
                          value={editRemark}
                          onChange={(e) => setEditRemark(e.target.value)}
                          placeholder="Remark (optional)"
                          rows={3}
                        />
                      </div>
                      <Button
                        onClick={() => void handleUpdateCircle()}
                        disabled={editStatus.type === "loading"}
                      >
                        <Save className="w-4 h-4 mr-1.5" />
                        Save
                      </Button>
                    </>
                  )}
                  {editStatus.type === "loading" && !editDetail && (
                    <p className="text-sm text-muted-foreground">Loading...</p>
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
