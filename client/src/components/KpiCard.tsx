import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

export default function KpiCard({ title, value, subtitle, trend, icon, variant = "default", className }: KpiCardProps) {
  const variantStyles = {
    default: "border-border",
    success: "border-emerald-500/30 bg-emerald-500/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    danger: "border-red-500/30 bg-red-500/5",
  };

  const iconBg = {
    default: "bg-primary/15 text-primary",
    success: "bg-emerald-500/15 text-emerald-400",
    warning: "bg-amber-500/15 text-amber-400",
    danger: "bg-red-500/15 text-red-400",
  };

  const trendColor = {
    default: "text-primary",
    success: "text-emerald-400",
    warning: "text-amber-400",
    danger: "text-red-400",
  };

  return (
    <Card className={cn("border", variantStyles[variant], className)}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground mb-1 truncate">{title}</p>
            <p className="text-lg sm:text-xl font-bold text-foreground leading-tight truncate">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>}
            {trend !== undefined && (
              <div className={cn("flex items-center gap-1 mt-1.5 text-xs font-medium",
                trend > 0 ? "text-emerald-400" : trend < 0 ? "text-red-400" : "text-muted-foreground"
              )}>
                {trend > 0 ? <TrendingUp className="h-3 w-3" /> : trend < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                <span>{trend > 0 ? "+" : ""}{trend.toFixed(1)}%</span>
              </div>
            )}
          </div>
          {icon && (
            <div className={cn("flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl shrink-0", iconBg[variant])}>
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
