import { useState, useEffect, useCallback, useRef } from "react";
import { fetchRanking, postJson } from "@/lib/api";
import type { RankingType, RankItem } from "@/types";
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
import { Plus, Minus, RotateCcw, Search, ChevronDown, ChevronUp } from "lucide-react";

const PAGE_SIZE_OPTIONS = [
  "5",
  "10",
  "15",
  "20",
  "25",
  "30",
  "40",
  "60",
  "100",
];

function getInitialParams() {
  const p = new URLSearchParams(location.search);
  return {
    ranking_type: (p.get("ranking_type") ?? "24h") as RankingType,
    page_size: p.get("page_size") ?? "20",
    rj_code: p.get("rj_code") ?? "",
    title: p.get("title") ?? "",
    circle: p.get("circle") ?? "",
    cv: p.get("cv") ?? "",
  };
}

export default function RankPage() {
  const init = getInitialParams();
  const [rankingType, setRankingType] = useState<RankingType>(
    init.ranking_type,
  );
  const [pageSize, setPageSize] = useState(init.page_size);
  const [rjCode, setRjCode] = useState(init.rj_code);
  const [title, setTitle] = useState(init.title);
  const [circle, setCircle] = useState(init.circle);
  const [cv, setCv] = useState(init.cv);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<RankItem[]>([]);
  const [rjExistsMap, setRjExistsMap] = useState<Record<string, boolean>>({});
  const [circleExistsMap, setCircleExistsMap] = useState<
    Record<string, boolean>
  >({});
  const [showDetails, setShowDetails] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "loading" | "error" | "ok";
    msg?: string;
  }>({ type: "idle" });
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (
      p: number,
      rt: RankingType,
      ps: string,
      filters: { rj_code: string; title: string; circle: string; cv: string },
    ) => {
      setStatus({ type: "loading" });
      const q = new URLSearchParams({
        ranking_type: rt,
        page: String(p),
        page_size: ps,
      });
      if (filters.rj_code.trim()) q.set("rj_code", filters.rj_code.trim());
      if (filters.title.trim()) q.set("title", filters.title.trim());
      if (filters.circle.trim()) q.set("circle", filters.circle.trim());
      if (filters.cv.trim()) q.set("cv", filters.cv.trim());
      history.replaceState(null, "", "?" + q.toString());
      try {
        const trimmed = Object.fromEntries(
          Object.entries(filters)
            .filter(([, v]) => v.trim())
            .map(([k, v]) => [k, v.trim()]),
        ) as { rj_code?: string; title?: string; circle?: string; cv?: string };
        const data = await fetchRanking({
          ranking_type: rt,
          page: p,
          page_size: Number(ps),
          ...trimmed,
        });
        setTotal(data.total);
        setItems(data.items);
        setStatus({ type: "ok", msg: `共 ${data.total} 条` });

        const rjCodes = data.items.map((i) => i.rj_code);
        const circles = [
          ...new Set(data.items.map((i) => i.circle).filter(Boolean)),
        ] as string[];
        const [rjRes, circleRes] = await Promise.all([
          rjCodes.length
            ? postJson<{ exists: Record<string, boolean> }>("/api/rj/check", {
                rj_codes: rjCodes,
              })
            : Promise.resolve({ exists: {} }),
          circles.length
            ? postJson<{ exists: Record<string, boolean> }>(
                "/api/circle/check",
                { names: circles },
              )
            : Promise.resolve({ exists: {} }),
        ]);
        setRjExistsMap((prev) => ({ ...prev, ...rjRes.exists }));
        setCircleExistsMap((prev) => ({ ...prev, ...circleRes.exists }));
      } catch (err) {
        setStatus({
          type: "error",
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [],
  );

  const currentFilters = { rj_code: rjCode, title, circle, cv };

  useEffect(() => {
    void load(page, rankingType, pageSize, currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSearch = (p = 1) => {
    setPage(p);
    void load(p, rankingType, pageSize, currentFilters);
  };

  const debouncedSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerSearch(1), 300);
  };

  const handleReset = () => {
    setRankingType("24h");
    setPageSize("20");
    setRjCode("");
    setTitle("");
    setCircle("");
    setCv("");
    setPage(1);
    void load(1, "24h", "20", { rj_code: "", title: "", circle: "", cv: "" });
  };

  const handleAction = async (action: string, item: RankItem) => {
    const key = `${action}-${item.rj_code}-${item.circle ?? ""}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      if (action === "add-rj") {
        await postJson("/api/rj/add", {
          rj_code: item.rj_code,
          ranking_type: rankingType,
        });
        setRjExistsMap((prev) => ({ ...prev, [item.rj_code]: true }));
      } else if (action === "remove-rj") {
        await postJson("/api/rj/remove", { rj_code: item.rj_code });
        setRjExistsMap((prev) => ({ ...prev, [item.rj_code]: false }));
      } else if (action === "add-circle" && item.circle) {
        await postJson("/api/circle/add", {
          name: item.circle,
          circle_url: item.circle_url,
        });
        setCircleExistsMap((prev) => ({ ...prev, [item.circle!]: true }));
      } else if (action === "remove-circle" && item.circle) {
        await postJson("/api/circle/remove", { name: item.circle });
        setCircleExistsMap((prev) => ({ ...prev, [item.circle!]: false }));
      }
      setStatus({ type: "ok", msg: "操作成功" });
    } catch (err) {
      setStatus({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const pages = Math.max(1, Math.ceil(total / Number(pageSize)));

  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="text-2xl font-bold mb-5 text-foreground">RJ 排行榜</h1>
      <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4 items-end">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">排行</label>
            <Select
              value={rankingType}
              onValueChange={(v) => {
                setRankingType(v as RankingType);
                triggerSearch(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">天</SelectItem>
                <SelectItem value="7d">周</SelectItem>
                <SelectItem value="30d">月</SelectItem>
                <SelectItem value="year">年</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">RJ号</label>
            <Input
              placeholder="输入 RJ 号"
              value={rjCode}
              onChange={(e) => {
                setRjCode(e.target.value);
                debouncedSearch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">标题</label>
            <Input
              placeholder="模糊查询标题"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                debouncedSearch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">社团</label>
            <Input
              placeholder="模糊查询社团"
              value={circle}
              onChange={(e) => {
                setCircle(e.target.value);
                debouncedSearch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">CV</label>
            <Input
              placeholder="模糊查询 CV"
              value={cv}
              onChange={(e) => {
                setCv(e.target.value);
                debouncedSearch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">每页</label>
            <Select
              value={pageSize}
              onValueChange={(v) => {
                setPageSize(v);
                triggerSearch(1);
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
          <Button onClick={() => triggerSearch(1)}><Search className="w-4 h-4 mr-1.5" />查询</Button>
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-1.5" />重置
          </Button>
        </div>

        {/* Status + toolbar */}
        <div className="flex items-center justify-between mb-3">
          <span
            className={`text-sm ${status.type === "error" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {status.type === "loading" ? "加载中..." : (status.msg ?? "")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDetails((v) => !v)}
          >
          {showDetails ? <><ChevronUp className="w-4 h-4 mr-1.5" />隐藏详情</> : <><ChevronDown className="w-4 h-4 mr-1.5" />显示详情</>}
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">排名</TableHead>
                {showDetails && <TableHead className="w-20">封面</TableHead>}
                <TableHead>RJ号</TableHead>
                {showDetails && <TableHead>标题</TableHead>}
                <TableHead>社团</TableHead>
                {showDetails && <TableHead>CV</TableHead>}
                {showDetails && <TableHead>发售日</TableHead>}
                {showDetails && <TableHead>标签</TableHead>}
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const rjExists = rjExistsMap[item.rj_code];
                const circleExists = item.circle
                  ? circleExistsMap[item.circle]
                  : undefined;
                return (
                  <TableRow key={item.rj_code}>
                    <TableCell className="text-muted-foreground font-mono">
                      {item.rank}
                    </TableCell>
                    {showDetails && (
                      <TableCell>
                        {item.thumbnail ? (
                          <img
                            src={item.thumbnail}
                            alt={item.rj_code}
                            className="w-14 h-14 object-cover rounded-md bg-muted"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-md bg-muted" />
                        )}
                      </TableCell>
                    )}
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
                      <TableCell className="max-w-xs">
                        <span className="line-clamp-2 text-sm">
                          {item.title_url ? (
                            <a
                              href={item.title_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline"
                            >
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="text-sm">
                      {item.circle_url ? (
                        <a
                          href={item.circle_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          {item.circle}
                        </a>
                      ) : (
                        (item.circle ?? (
                          <span className="text-muted-foreground">-</span>
                        ))
                      )}
                    </TableCell>
                    {showDetails && (
                      <TableCell className="text-sm text-muted-foreground">
                        {item.cv ?? "-"}
                      </TableCell>
                    )}
                    {showDetails && (
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {item.release_date ?? "-"}
                      </TableCell>
                    )}
                    {showDetails && (
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[240px]">
                          {item.tags.map((t) => (
                            <Badge key={t} variant="secondary">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        <Button
                          size="sm"
                          variant={rjExists ? "destructive" : "default"}
                          disabled={
                            actionLoading[
                              `${rjExists ? "remove" : "add"}-rj-${item.rj_code}-`
                            ]
                          }
                          onClick={() =>
                            handleAction(
                              rjExists ? "remove-rj" : "add-rj",
                              item,
                            )
                          }
                        >
                          {rjExists ? <><Minus className="w-3.5 h-3.5 mr-1" />移除 RJ</> : <><Plus className="w-3.5 h-3.5 mr-1" />添加 RJ</>}
                        </Button>
                        {item.circle && (
                          <Button
                            size="sm"
                            variant={circleExists ? "destructive" : "outline"}
                            disabled={
                              actionLoading[
                                `${circleExists ? "remove" : "add"}-circle-${item.rj_code}-${item.circle}`
                              ]
                            }
                            onClick={() =>
                              handleAction(
                                circleExists ? "remove-circle" : "add-circle",
                                item,
                              )
                            }
                          >
                            {circleExists ? <><Minus className="w-3.5 h-3.5 mr-1" />移除社团</> : <><Plus className="w-3.5 h-3.5 mr-1" />添加社团</>}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && status.type !== "loading" && (
                <TableRow>
                  <TableCell
                    colSpan={showDetails ? 9 : 4}
                    className="text-center text-muted-foreground py-10"
                  >
                    暂无数据
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pager */}
        <div className="flex items-center justify-end gap-3 mt-4 text-sm text-muted-foreground">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1);
              void load(page - 1, rankingType, pageSize, currentFilters);
            }}
          >
            上一页
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
              void load(page + 1, rankingType, pageSize, currentFilters);
            }}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
