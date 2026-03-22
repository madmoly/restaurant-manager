import { type ReactNode, type ButtonHTMLAttributes, useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

// ─── Button ──────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950 disabled:bg-slate-300",
  secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-300",
  ghost: "text-slate-600 hover:bg-slate-100 active:bg-slate-200",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-sm gap-2",
};

export function Button({ variant = "primary", size = "md", icon, children, className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-lg transition-colors duration-150 disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
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
        "bg-white rounded-xl border border-slate-200 overflow-hidden",
        interactive && "cursor-pointer hover:border-slate-300 hover:shadow-sm transition-all duration-150",
        className
      )}
    >
      {children}
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────
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
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-2">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
      {trend && (
        <div className={cn("text-xs mt-1 font-medium", trend.value >= 0 ? "text-emerald-600" : "text-red-500")}>
          {trend.value >= 0 ? "+" : ""}{trend.value}%{trend.label ? ` ${trend.label}` : ""}
        </div>
      )}
    </Card>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="py-16 flex flex-col items-center text-center">
      {icon && <div className="text-slate-300 mb-3">{icon}</div>}
      <p className="text-sm font-medium text-slate-500">{title}</p>
      {description && <p className="text-xs text-slate-400 mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={cn(
        "bg-white w-full sm:rounded-xl rounded-t-2xl shadow-2xl animate-in sm:mx-4",
        maxWidth
      )}>
        {title && (
          <div className="flex items-center justify-between px-5 pt-5 pb-0">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 -mr-1">
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Input ───────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>}
      <input
        className={cn(
          "w-full px-3 py-2.5 border rounded-lg text-sm transition-colors duration-150",
          "focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400",
          error ? "border-red-300 bg-red-50" : "border-slate-200 bg-white",
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ─── Select ──────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
}

export function Select({ label, options, className, ...props }: SelectProps) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>}
      <select
        className={cn(
          "w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white",
          "focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400",
          className
        )}
        {...props}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────────────
type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: "bg-slate-100 text-slate-600",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
};

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: BadgeVariant }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium", BADGE_VARIANTS[variant])}>
      {children}
    </span>
  );
}

// ─── MonthNav ────────────────────────────────────────────────────────────────
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
      <button onClick={onPrev} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <span className="text-sm font-semibold text-slate-800 min-w-[100px] text-center">{year}년 {month}월</span>
      <button onClick={onNext} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {rightSlot && <div className="ml-auto">{rightSlot}</div>}
    </div>
  );
}

// ─── PageHeader ──────────────────────────────────────────────────────────────
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ─── Loading ─────────────────────────────────────────────────────────────────
export function Loading() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-5 h-5 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );
}
