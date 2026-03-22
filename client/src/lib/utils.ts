import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 숫자를 한국 원화 포맷으로 변환 */
export function formatKRW(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  if (isNaN(n)) return "0원";
  return n.toLocaleString("ko-KR") + "원";
}

/** 숫자를 축약 포맷으로 변환 (만/억 단위) */
export function formatCompactKRW(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  if (isNaN(n)) return "0";
  if (Math.abs(n) >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (Math.abs(n) >= 10_000) return (n / 10_000).toFixed(0) + "만";
  return n.toLocaleString("ko-KR");
}

/** 퍼센트 포맷 */
export function formatPercent(value: number | string | null | undefined, decimals = 1): string {
  const n = Number(value ?? 0);
  if (isNaN(n)) return "0%";
  return n.toFixed(decimals) + "%";
}
