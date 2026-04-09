/**
 * compat.tsx — 기존 페이지 호환용 UI 컴포넌트
 *
 * Phase 0에서 기존 페이지들이 사용하던 커스텀 컴포넌트를 테마 대응으로 재작성.
 * 새 페이지는 shadcn/ui 컴포넌트를 직접 사용할 것.
 * Phase 1+ 에서 점진적으로 제거 예정.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── re-export shadcn components under the same names ──
export { Button } from "@/components/ui/button";

// ── Card (간단한 wrapper, 기존 API 호환) ─────────────────────────────────────
interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
}

export function Card({ children, className, onClick, interactive }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-card rounded-xl border border-border overflow-hidden text-card-foreground",
        interactive && "cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all duration-150",
        className
      )}
    >
      {children}
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: { value: number; label?: string };
  className?: string;
}

export function StatCard({ label, value, unit, icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-foreground tabular-nums">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {trend && (
        <div className={cn("text-xs mt-1 font-medium", trend.value >= 0 ? "text-emerald-500" : "text-red-500")}>
          {trend.value >= 0 ? "+" : ""}{trend.value}%{trend.label ? ` ${trend.label}` : ""}
        </div>
      )}
    </Card>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="py-16 flex flex-col items-center text-center">
      {icon && <div className="text-muted-foreground/40 mb-3">{icon}</div>}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = "max-w-lg" }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={cn(
        "bg-card w-full sm:rounded-xl rounded-t-2xl shadow-2xl animate-in border border-border",
        maxWidth
      )}>
        {title && (
          <div className="flex items-center justify-between px-5 pt-5 pb-0">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 -mr-1 transition-colors">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Input (label 지원 버전) ──────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>}
      <input
        className={cn(
          "w-full px-3 py-2.5 border rounded-lg text-sm transition-colors duration-150 bg-background text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary",
          error ? "border-red-400 bg-red-500/5" : "border-border",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ── Select (options array 버전) ──────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
}

export function Select({ label, options, className, ...props }: SelectProps) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>}
      <select
        className={cn(
          "w-full px-3 py-2.5 border border-border rounded-lg text-sm bg-background text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary",
          className
        )}
        {...props}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Badge ────────────────────────────────────────────────────────────────────
type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/15 text-emerald-500",
  warning: "bg-amber-500/15 text-amber-500",
  danger: "bg-red-500/15 text-red-500",
  info: "bg-sky-500/15 text-sky-500",
};

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: BadgeVariant }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium", BADGE_VARIANTS[variant])}>
      {children}
    </span>
  );
}

// ── MonthNav ─────────────────────────────────────────────────────────────────
interface MonthNavProps {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  rightSlot?: ReactNode;
}

export function MonthNav({ year, month, onPrev, onNext, rightSlot }: MonthNavProps) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <button onClick={onPrev} className="p-2 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-semibold text-foreground min-w-[100px] text-center">{year}년 {month}월</span>
      <button onClick={onNext} className="p-2 rounded-lg hover:bg-accent text-muted-foreground transition-colors">
        <ChevronRight className="h-4 w-4" />
      </button>
      {rightSlot && <div className="ml-auto">{rightSlot}</div>}
    </div>
  );
}

// ── PageHeader ───────────────────────────────────────────────────────────────
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Loading ──────────────────────────────────────────────────────────────────
export function Loading() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
    </div>
  );
}
