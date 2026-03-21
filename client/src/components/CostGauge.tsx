import { cn } from "@/lib/utils";

interface CostGaugeProps {
  label: string;
  value: number; // 현재 비율 (%)
  target: number; // 목표 비율 (%)
  className?: string;
}

function getStatus(value: number, target: number): "safe" | "warning" | "danger" {
  if (value <= target * 0.9) return "safe";
  if (value <= target) return "warning";
  return "danger";
}

export default function CostGauge({ label, value, target, className }: CostGaugeProps) {
  const status = getStatus(value, target);
  const pct = Math.min(100, (value / (target * 1.5)) * 100);

  const colors = {
    safe: { bar: "bg-green-500", text: "text-green-600", bg: "bg-green-50 border-green-200" },
    warning: { bar: "bg-amber-500", text: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
    danger: { bar: "bg-red-500", text: "text-red-600", bg: "bg-red-50 border-red-200" },
  };

  const c = colors[status];

  return (
    <div className={cn("p-3 rounded-lg border", c.bg, className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <span className={cn("text-sm font-bold", c.text)}>{value.toFixed(1)}%</span>
          <span className="text-xs text-muted-foreground">/ {target}%</span>
        </div>
      </div>
      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", c.bar)}
          style={{ width: `${pct}%` }}
        />
        {/* 목표선 */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-foreground/30"
          style={{ left: `${(1 / 1.5) * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-muted-foreground">0%</span>
        <span className="text-xs text-muted-foreground">목표 {target}%</span>
      </div>
      {status === "danger" && (
        <p className="text-xs text-red-600 font-medium mt-1">⚠ 목표 초과</p>
      )}
    </div>
  );
}
