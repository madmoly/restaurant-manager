import { trpc } from "../lib/trpc";
import { useLocation } from "wouter";
import { Store, Users, TrendingUp, AlertTriangle, Bug } from "lucide-react";
import { StatCard, Card, PageHeader, EmptyState, Loading, Button } from "@/components/ui/compat";

export default function AdminDashboard() {
  const { data: restaurants, isLoading } = trpc.restaurants.list.useQuery();
  const { data: errorSummary } = trpc.errorLogs.recentSummary.useQuery();
  const [, setLocation] = useLocation();

  return (
    <div>
      <PageHeader
        title="관리자 대시보드"
        description="전체 매장 현황"
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<Store size={14} />} label="운영 매장" value={isLoading ? "—" : (restaurants?.length ?? 0)} />
        <StatCard icon={<TrendingUp size={14} />} label="이번 달 총매출" value="—" />
        <StatCard icon={<Users size={14} />} label="전체 직원" value="—" />
        <StatCard
          icon={<Bug size={14} />}
          label="에러 (24h / 7d)"
          value={errorSummary ? `${errorSummary.last24h} / ${errorSummary.last7d}` : "—"}
        />
      </div>

      {/* 에러 요약 — 24시간 내 에러가 있을 때만 표시 */}
      {errorSummary && errorSummary.last24h > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">최근 24시간 에러 {errorSummary.last24h}건</span>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {errorSummary.byType.map((t: any) => (
              <span key={t.errorType}>{t.errorType}: {t.count}건</span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">매장 목록</h3>
        <button onClick={() => setLocation("/restaurants")} className="text-xs text-muted-foreground hover:text-foreground">
          매장 관리 →
        </button>
      </div>

      {isLoading ? <Loading /> : !restaurants?.length ? (
        <EmptyState
          icon={<Store size={36} />}
          title="등록된 매장이 없습니다"
          action={<Button size="sm" onClick={() => setLocation("/restaurants")}>첫 매장 등록하기</Button>}
        />
      ) : (
        <div className="space-y-2">
          {restaurants.map((r: any) => (
            <Card key={r.id} interactive onClick={() => setLocation(`/sales/${r.id}`)} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.address || "주소 미등록"}</p>
              </div>
              <span className="text-xs text-muted-foreground">매출 조회 →</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
