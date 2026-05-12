import { useState, useEffect, useCallback, useRef } from "react";
import { fetchCircleList, fetchCircleDetail, fetchCircleWorks, postJson } from "@/lib/api";
import type { CircleItem, CircleDetail, CircleWork } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

function getInitialParams() {
  const p = new URLSearchParams(location.search);
  return {
    page_size: p.get("page_size") ?? "20",
    name: p.get("name") ?? "",
    nickname: p.get("nickname") ?? "",
    remark: p.get("remark") ?? "",
  };
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
  const [listStatus, setListStatus] = useState<{ type: "idle" | "loading" | "error" | "ok"; msg?: string }>({ type: "idle" });

  const [selectedCircle, setSelectedCircle] = useState<string | null>(null);
  const [detail, setDetail] = useState<CircleDetail | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const [detailStatus, setDetailStatus] = useState<{ type: "idle" | "loading" | "error" | "ok"; msg?: string }>({ type: "idle" });

  const [worksPage, setWorksPage] = useState(1);
  const [worksPageSize] = useState("20");
  const [worksRjCode, setWorksRjCode] = useState("");
  const [worksTitle, setWorksTitle] = useState("");
  const [worksTotal, setWorksTotal] = useState(0);
  const [works, setWorks] = useState<CircleWork[]>([]);
  const [worksStatus, setWorksStatus] = useState<{ type: "idle" | "loading" | "error" | "ok"; msg?: string }>({ type: "idle" });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCircles = useCallback(
    async (p: number, ps: string, filters: { name: string; nickname: string; remark: string }) => {
      setListStatus({ type: "loading" });
      const q = new URLSearchParams({ page: String(p), page_size: ps });
      if (filters.name.trim()) q.set("name", filters.name.trim());
      if (filters.nickname.trim()) q.set("nickname", filters.nickname.trim());
      if (filters.remark.trim()) q.set("remark", filters.remark.trim());
      history.replaceState(null, "", "/circle?" + q.toString());
      try {
        const trimmed = Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])
        ) as { name?: string; nickname?: string; remark?: string };
        const data = await fetchCircleList({ page: p, page_size: Number(ps), ...trimmed });
        setTotal(data.total);
        setCircles(data.data);
        setListStatus({ type: "ok", msg: `共 ${data.total} 条` });
      } catch (err) {
        setListStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
      }
    },
    []
  );

  const loadWorks = useCallback(async (circleName: string, p: number, ps: string, rj: string, t: string) => {
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
      setWorksStatus({ type: "ok", msg: `共 ${data.total} 条` });
    } catch (err) {
      setWorksStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const currentFilters = { name, nickname, remark };

  useEffect(() => {
    void loadCircles(page, pageSize, currentFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectCircle = async (circleName: string) => {
    setSelectedCircle(circleName);
    setDetailStatus({ type: "loading" });
    setWorksPage(1);
    setWorksRjCode("");
    setWorksTitle("");
    try {
      const d = await fetchCircleDetail(circleName);
      setDetail(d);
      setEditNickname(d.nickname ?? "");
      setEditUrl(d.circle_url ?? "");
      setEditRemark(d.remark ?? "");
      setDetailStatus({ type: "ok" });
    } catch (err) {
      setDetailStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
    void loadWorks(circleName, 1, worksPageSize, "", "");
  };

  const handleUpdateCircle = async () => {
    if (!selectedCircle) return;
    setDetailStatus({ type: "loading" });
    try {
      await postJson("/api/circle/update", {
        name: selectedCircle,
        nickname: editNickname.trim() || null,
        circle_url: editUrl.trim() || null,
        remark: editRemark.trim() || null,
      });
      setDetailStatus({ type: "ok", msg: "保存成功" });
      void loadCircles(page, pageSize, currentFilters);
    } catch (err) {
      setDetailStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleRemoveCircle = async () => {
    if (!selectedCircle) return;
    if (!confirm(`确认移除社团「${selectedCircle}」？`)) return;
    try {
      await postJson("/api/circle/remove", { name: selectedCircle });
      setSelectedCircle(null);
      setDetail(null);
      void loadCircles(page, pageSize, currentFilters);
    } catch (err) {
      setDetailStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleRemoveWork = async (rjCode: string) => {
    if (!selectedCircle) return;
    try {
      await postJson("/api/circle/work/remove", { circle_name: selectedCircle, rj_code: rjCode });
      void loadWorks(selectedCircle, worksPage, worksPageSize, worksRjCode, worksTitle);
    } catch (err) {
      setWorksStatus({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    }
  };

  const debouncedSearch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); void loadCircles(1, pageSize, currentFilters); }, 300);
  };

  const worksPages = Math.max(1, Math.ceil(worksTotal / Number(worksPageSize)));
  const pages = Math.max(1, Math.ceil(total / Number(pageSize)));

  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="text-2xl font-bold mb-5 text-foreground">社团管理</h1>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">

        {/* Left column */}
        <div className="flex flex-col gap-4">

          {/* Circle list */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
            <h2 className="text-base font-semibold mb-4 text-card-foreground">社团列表</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3 items-end">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">社团名</label>
                <Input placeholder="模糊查询" value={name} onChange={(e) => { setName(e.target.value); debouncedSearch(); }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">别名</label>
                <Input placeholder="模糊查询" value={nickname} onChange={(e) => { setNickname(e.target.value); debouncedSearch(); }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">备注</label>
                <Input placeholder="模糊查询" value={remark} onChange={(e) => { setRemark(e.target.value); debouncedSearch(); }} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">每页</label>
                <Select value={pageSize} onValueChange={(v) => { setPageSize(v); setPage(1); void loadCircles(1, v, currentFilters); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => { setPage(1); void loadCircles(1, pageSize, currentFilters); }}>查询</Button>
            </div>

            <div className="text-sm text-muted-foreground mb-2 h-5">
              {listStatus.type === "loading" ? "加载中..." : listStatus.type === "error"
                ? <span className="text-destructive">{listStatus.msg}</span>
                : listStatus.msg}
            </div>

            <div className="rounded-lg border border-border overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>社团名</TableHead>
                    <TableHead>别名</TableHead>
                    <TableHead className="w-16">RJ数</TableHead>
                    <TableHead>备注</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {circles.map((c) => (
                    <TableRow
                      key={c.name}
                      className={`cursor-pointer ${selectedCircle === c.name ? "bg-accent text-accent-foreground" : ""}`}
                      onClick={() => void selectCircle(c.name)}
                    >
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">{c.nickname ?? "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.rj_count ?? "-"}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">{c.remark ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                  {circles.length === 0 && listStatus.type !== "loading" && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">暂无数据</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-end gap-3 mt-3 text-sm text-muted-foreground">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage((p) => p - 1); void loadCircles(page - 1, pageSize, currentFilters); }}>上一页</Button>
              <span>{page} / {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => { setPage((p) => p + 1); void loadCircles(page + 1, pageSize, currentFilters); }}>下一页</Button>
            </div>
          </div>

          {/* Works panel */}
          {selectedCircle && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
              <h2 className="text-base font-semibold mb-4 text-card-foreground">「{selectedCircle}」的作品</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 items-end">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">RJ号</label>
                  <Input placeholder="筛选" value={worksRjCode} onChange={(e) => { setWorksRjCode(e.target.value); void loadWorks(selectedCircle, 1, worksPageSize, e.target.value, worksTitle); }} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">标题</label>
                  <Input placeholder="筛选" value={worksTitle} onChange={(e) => { setWorksTitle(e.target.value); void loadWorks(selectedCircle, 1, worksPageSize, worksRjCode, e.target.value); }} />
                </div>
              </div>

              <div className="text-sm text-muted-foreground mb-2 h-5">
                {worksStatus.type === "loading" ? "加载中..." : worksStatus.type === "error"
                  ? <span className="text-destructive">{worksStatus.msg}</span>
                  : worksStatus.msg}
              </div>

              <div className="rounded-lg border border-border overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>RJ号</TableHead>
                      <TableHead>标题</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>发售日</TableHead>
                      <TableHead className="w-20">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {works.map((w) => (
                      <TableRow key={w.rj_code}>
                        <TableCell className="font-medium">
                          {w.title_url
                            ? <a href={w.title_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{w.rj_code}</a>
                            : w.rj_code}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm">{w.title ?? "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{w.status ?? "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{w.release_date ?? "-"}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="destructive" onClick={() => void handleRemoveWork(w.rj_code)}>移除</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {works.length === 0 && worksStatus.type !== "loading" && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">暂无作品</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-end gap-3 mt-3 text-sm text-muted-foreground">
                <Button variant="outline" size="sm" disabled={worksPage <= 1} onClick={() => { setWorksPage((p) => p - 1); void loadWorks(selectedCircle, worksPage - 1, worksPageSize, worksRjCode, worksTitle); }}>上一页</Button>
                <span>{worksPage} / {worksPages}</span>
                <Button variant="outline" size="sm" disabled={worksPage >= worksPages} onClick={() => { setWorksPage((p) => p + 1); void loadWorks(selectedCircle, worksPage + 1, worksPageSize, worksRjCode, worksTitle); }}>下一页</Button>
              </div>
            </div>
          )}
        </div>

        {/* Right: detail editor */}
        {selectedCircle && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-lg sticky top-6">
            <h2 className="text-base font-semibold mb-1 text-card-foreground">编辑社团</h2>
            <p className="text-sm text-muted-foreground mb-4 truncate">{selectedCircle}</p>

            {detailStatus.type === "error" && (
              <p className="text-destructive text-sm mb-3">{detailStatus.msg}</p>
            )}
            {detailStatus.type === "ok" && detailStatus.msg && (
              <p className="text-sm mb-3" style={{ color: "oklch(0.696 0.17 162.48)" }}>{detailStatus.msg}</p>
            )}

            {detail && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">别名</label>
                  <Input value={editNickname} onChange={(e) => setEditNickname(e.target.value)} placeholder="别名（可选）" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">社团链接</label>
                  <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="https://..." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">备注</label>
                  <Textarea value={editRemark} onChange={(e) => setEditRemark(e.target.value)} placeholder="备注（可选）" rows={3} />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => void handleUpdateCircle()} disabled={detailStatus.type === "loading"}>保存</Button>
                  <Button variant="destructive" onClick={() => void handleRemoveCircle()}>移除</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
