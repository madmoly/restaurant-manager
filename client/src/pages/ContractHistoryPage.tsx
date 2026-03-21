import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  FileText, ChevronDown, ChevronUp, Search, Download,
  CheckCircle2, Clock, XCircle, Send, AlertTriangle,
  ArrowRight, RefreshCw, User
} from "lucide-react";
import { toast } from "sonner";

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}
function fmtWage(wageType: string, wageAmount: string) {
  const n = parseFloat(wageAmount);
  if (isNaN(n)) return "—";
  return wageType === "hourly"
    ? `시급 ${n.toLocaleString()}원`
    : `월급 ${n.toLocaleString()}원`;
}
function contractTypeLabel(t: string) {
  const map: Record<string, string> = { permanent: "정규직", fixed_term: "기간제", part_time: "단시간", daily: "일용직" };
  return map[t] || t;
}
function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    draft:     { label: "초안",     cls: "bg-zinc-700/60 text-zinc-300 border-zinc-600/40",         icon: <Clock className="h-3 w-3" /> },
    sent:      { label: "발송됨",   cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",          icon: <Send className="h-3 w-3" /> },
    signed:    { label: "서명완료", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: <CheckCircle2 className="h-3 w-3" /> },
    expired:   { label: "만료",     cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",       icon: <AlertTriangle className="h-3 w-3" /> },
    cancelled: { label: "취소",     cls: "bg-red-500/10 text-red-400 border-red-500/20",             icon: <XCircle className="h-3 w-3" /> },
  };
  const m = map[status] || { label: status, cls: "bg-zinc-700/60 text-zinc-300", icon: null };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${m.cls}`}>
      {m.icon}{m.label}
    </span>
  );
}
function dDayBadge(contractEnd: string | null | undefined) {
  if (!contractEnd) return null;
  const diff = Math.ceil((new Date(contractEnd).getTime() - Date.now()) / 86400000);
  if (diff < 0) return <span className="text-xs text-zinc-500">만료됨</span>;
  const cls = diff <= 30 ? "text-red-400" : diff <= 90 ? "text-amber-400" : "text-zinc-400";
  return <span className={`text-xs font-medium ${cls}`}>D-{diff}</span>;
}

// ─── 계약 카드 ─────────────────────────────────────────────────────────────────
type Contract = {
  id: number; token: string; status: string; contractType: string;
  contractStart: string | Date; contractEnd: string | Date | null;
  wageType: string; wageAmount: string; position: string;
  createdAt: string | Date; signedAt: string | Date | null;
  previousContractId: number | null;
  employeeName: string; employeePhone: string | null;
};

function ContractCard({ c, restaurantName, isFirst }: { c: Contract; restaurantName: string; isFirst: boolean }) {
  const [open, setOpen] = useState(false);
  const pdfUrl = `/api/contract/pdf/${c.token}`;
  const durationMonths = c.contractEnd
    ? Math.round((new Date(c.contractEnd).getTime() - new Date(c.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
    : null;
  const isProbation = c.contractType === "fixed_term" && durationMonths !== null && durationMonths <= 3;

  return (
    <div className={`rounded-xl border ${isFirst ? "border-blue-500/30 bg-blue-500/5" : "border-border/50 bg-card/50"} overflow-hidden`}>
      {/* 헤더 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isProbation ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{contractTypeLabel(c.contractType)}</span>
              {isProbation && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">수습</span>}
              {isFirst && <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">최신</span>}
              {statusBadge(c.status)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmtDate(c.contractStart)} ~ {c.contractEnd ? fmtDate(c.contractEnd) : "무기한"}
              {c.contractEnd && <span className="ml-2">{dDayBadge(String(c.contractEnd))}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground hidden sm:block">{fmtWage(c.wageType, c.wageAmount)}</span>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* 상세 */}
      {open && (
        <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div><span className="text-muted-foreground">직책</span><span className="ml-2 text-foreground">{c.position}</span></div>
            <div><span className="text-muted-foreground">급여</span><span className="ml-2 text-foreground">{fmtWage(c.wageType, c.wageAmount)}</span></div>
            <div><span className="text-muted-foreground">계약 시작</span><span className="ml-2 text-foreground">{fmtDate(c.contractStart)}</span></div>
            <div><span className="text-muted-foreground">계약 종료</span><span className="ml-2 text-foreground">{c.contractEnd ? fmtDate(c.contractEnd) : "무기한"}</span></div>
            {c.signedAt && (
              <div className="col-span-2"><span className="text-muted-foreground">서명 일시</span><span className="ml-2 text-emerald-400">{new Date(c.signedAt).toLocaleString("ko-KR")}</span></div>
            )}
            <div><span className="text-muted-foreground">생성일</span><span className="ml-2 text-foreground">{fmtDate(c.createdAt)}</span></div>
            {c.previousContractId && (
              <div><span className="text-muted-foreground">이전 계약 ID</span><span className="ml-2 text-blue-400">#{c.previousContractId}</span></div>
            )}
          </div>
          {c.status === "signed" && (
            <a href={pdfUrl} download
              className="inline-flex items-center gap-1.5 h-7 text-xs px-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors">
              <Download className="h-3 w-3" /> PDF 다운로드
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function ContractHistoryPage() {
  const { user } = useAuth();
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<number | null>(null);
  const [searchName, setSearchName] = useState("");
  const [debouncedName, setDebouncedName] = useState("");

  // 점장은 listMine, 관리자/마스터는 listAll
  // user가 완전히 로드된 후에만 쿼리 실행 (권한 오류 방지)
  const isAdmin = user?.role === "admin" || user?.role === "master";
  const listAllQuery = trpc.restaurants.listAll.useQuery({ withStats: false }, { enabled: !!user && isAdmin });
  const listMineQuery = trpc.restaurants.listMine.useQuery(undefined, { enabled: !!user && !isAdmin });
  const restaurants = (isAdmin ? (listAllQuery.data ?? []) : (listMineQuery.data ?? [])) as Array<{ id: number; name: string }>;

  const contractsQuery = trpc.electronicContracts.list.useQuery(
    { restaurantId: selectedRestaurantId ?? 0 },
    { enabled: !!selectedRestaurantId }
  );
  const contracts = contractsQuery.data ?? [];

  // 직원 이름으로 그룹핑
  const grouped = useMemo(() => {
    const filtered = debouncedName
      ? contracts.filter(c => c.employeeName.includes(debouncedName))
      : contracts;

    const map = new Map<string, typeof contracts>();
    for (const c of filtered) {
      const key = c.employeeName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).map(([name, list]) => ({
      name,
      phone: list[0]?.employeePhone ?? "—",
      contracts: list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      latestStatus: list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]?.status ?? "draft",
    }));
  }, [contracts, debouncedName]);

  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

  const selectedRestaurant = restaurants.find(r => r.id === selectedRestaurantId);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        {/* 헤더 */}
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            직원별 계약 이력
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            수습 → 계약직 전환 이력, 급여 변동, 서명 날짜를 타임라인으로 확인합니다.
          </p>
        </div>

        {/* 매장 선택 */}
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={selectedRestaurantId ?? ""}
            onChange={e => setSelectedRestaurantId(e.target.value ? Number(e.target.value) : null)}
            className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="">매장을 선택하세요</option>
            {restaurants.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="직원 이름 검색..."
              value={searchName}
              onChange={e => {
                setSearchName(e.target.value);
                clearTimeout((window as any).__nameSearchTimer);
                (window as any).__nameSearchTimer = setTimeout(() => setDebouncedName(e.target.value), 300);
              }}
              className="w-full h-9 rounded-lg border border-border bg-background pl-8 pr-3 text-sm"
            />
          </div>
        </div>

        {/* 로딩 */}
        {contractsQuery.isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            계약 이력을 불러오는 중...
          </div>
        )}

        {/* 매장 미선택 */}
        {!selectedRestaurantId && (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">매장을 선택하면 직원별 계약 이력이 표시됩니다.</p>
          </div>
        )}

        {/* 직원 목록 */}
        {selectedRestaurantId && !contractsQuery.isLoading && grouped.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <User className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{debouncedName ? `"${debouncedName}"에 해당하는 직원이 없습니다.` : "등록된 계약서가 없습니다."}</p>
          </div>
        )}

        {grouped.map(({ name, phone, contracts: empContracts, latestStatus }) => {
          const isExpanded = expandedEmployee === name;
          const signedCount = empContracts.filter(c => c.status === "signed").length;
          const probationCount = empContracts.filter(c => {
            const dur = c.contractEnd
              ? Math.round((new Date(c.contractEnd).getTime() - new Date(c.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
              : null;
            return c.contractType === "fixed_term" && dur !== null && dur <= 3;
          }).length;

          return (
            <div key={name} className="rounded-xl border border-border/60 bg-card overflow-hidden">
              {/* 직원 헤더 */}
              <button
                onClick={() => setExpandedEmployee(isExpanded ? null : name)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/20 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-sm font-bold text-blue-300">
                    {name[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{name}</span>
                      {statusBadge(latestStatus)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {phone} · 계약 {empContracts.length}건
                      {probationCount > 0 && ` · 수습 ${probationCount}건`}
                      {signedCount > 0 && ` · 서명완료 ${signedCount}건`}
                    </p>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              {/* 계약 타임라인 */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-border/30 pt-3 space-y-3">
                  {/* 타임라인 요약 */}
                  <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground mb-2">
                    {empContracts.slice().reverse().map((c, i) => {
                      const dur = c.contractEnd
                        ? Math.round((new Date(c.contractEnd).getTime() - new Date(c.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
                        : null;
                      const isProb = c.contractType === "fixed_term" && dur !== null && dur <= 3;
                      return (
                        <span key={c.id} className="flex items-center gap-1">
                          {i > 0 && <ArrowRight className="h-3 w-3" />}
                          <span className={`px-1.5 py-0.5 rounded ${isProb ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"}`}>
                            {isProb ? "수습" : contractTypeLabel(c.contractType)}
                          </span>
                        </span>
                      );
                    })}
                  </div>

                  {/* 계약서 카드 목록 */}
                  <div className="space-y-2">
                    {empContracts.map((c, i) => (
                      <ContractCard
                        key={c.id}
                        c={c as Contract}
                        restaurantName={selectedRestaurant?.name ?? ""}
                        isFirst={i === 0}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppLayout>
  );
}
