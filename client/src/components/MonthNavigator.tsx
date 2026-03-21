import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MonthNavigatorProps {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  /** 선택 가능한 연도 범위 (기본: 2023~현재+1) */
  yearRange?: number[];
  className?: string;
}

export function MonthNavigator({ year, month, onChange, yearRange, className }: MonthNavigatorProps) {
  const currentYear = new Date().getFullYear();
  const years = yearRange ?? Array.from({ length: currentYear - 2022 }, (_, i) => 2023 + i);

  const prev = () => {
    if (month === 1) onChange(year - 1, 12);
    else onChange(year, month - 1);
  };
  const next = () => {
    if (month === 12) onChange(year + 1, 1);
    else onChange(year, month + 1);
  };

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prev} aria-label="이전 달">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Select value={String(year)} onValueChange={v => onChange(Number(v), month)}>
        <SelectTrigger className="w-24 h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {years.map(y => <SelectItem key={y} value={String(y)}>{y}년</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={String(month)} onValueChange={v => onChange(year, Number(v))}>
        <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <SelectItem key={m} value={String(m)}>{m}월</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={next} aria-label="다음 달">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
