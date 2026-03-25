import { Skeleton } from "./skeleton";

// ── 통계 카드 스켈레톤 ──────────────────────────────────────────────────────
export function StatCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-5">
      <div className="absolute top-0 left-0 w-1 h-full bg-muted rounded-l-xl" />
      <Skeleton className="h-3 w-16 mb-2" />
      <Skeleton className="h-7 w-24 mb-1" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

// ── KPI 그리드 스켈레톤 (2열 또는 4열) ───────────────────────────────────────
export function KpiGridSkeleton({ cols = 2 }: { cols?: 2 | 4 }) {
  return (
    <div className={`grid gap-3 ${cols === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ── 카드 스켈레톤 (범용) ─────────────────────────────────────────────────────
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" style={{ width: `${85 - i * 15}%` }} />
      ))}
    </div>
  );
}

// ── 비용 카드 리스트 스켈레톤 (ProfitPage용) ─────────────────────────────────
export function CostCardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-28" />
            </div>
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 회사 카드 리스트 스켈레톤 (LaborCostPage용) ──────────────────────────────
export function CompanyCardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-4 h-4 rounded shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="text-right space-y-1.5">
              <Skeleton className="h-4 w-20 ml-auto" />
              <Skeleton className="h-3 w-12 ml-auto" />
            </div>
            <Skeleton className="w-4 h-4 rounded-full shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 테이블 스켈레톤 ──────────────────────────────────────────────────────────
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="bg-muted/50 px-4 py-2 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="px-4 py-2.5 border-t border-border/50 flex gap-4">
          {Array.from({ length: cols }).map((_, ci) => (
            <Skeleton key={ci} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── 월 네비게이션 스켈레톤 ────────────────────────────────────────────────────
export function MonthNavSkeleton() {
  return (
    <div className="flex items-center justify-between bg-card border border-border rounded-lg p-3">
      <Skeleton className="w-8 h-8 rounded" />
      <Skeleton className="h-5 w-24" />
      <Skeleton className="w-8 h-8 rounded" />
    </div>
  );
}

// ── 페이지 헤더 스켈레톤 ──────────────────────────────────────────────────────
export function PageHeaderSkeleton() {
  return (
    <div className="mb-6">
      <Skeleton className="h-6 w-32 mb-1" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

// ── ProfitPage 전체 스켈레톤 ──────────────────────────────────────────────────
export function ProfitPageSkeleton() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <MonthNavSkeleton />
      {/* 큰 수익 카드 */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="w-5 h-5 rounded-full" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-9 w-40 mb-1" />
        <Skeleton className="h-3 w-16" />
      </div>
      {/* 비용 구성 */}
      <Skeleton className="h-4 w-16" />
      <CostCardListSkeleton />
    </div>
  );
}

// ── LaborCostPage 전체 스켈레톤 ──────────────────────────────────────────────
export function LaborCostPageSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-8 w-20 rounded" />
      </div>
      <MonthNavSkeleton />
      <KpiGridSkeleton cols={2} />
      <CompanyCardListSkeleton />
    </div>
  );
}

// ── 대시보드 전체 스켈레톤 ────────────────────────────────────────────────────
export function DashboardSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeaderSkeleton />
      <KpiGridSkeleton cols={4} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>
      <CardSkeleton lines={4} />
    </div>
  );
}
