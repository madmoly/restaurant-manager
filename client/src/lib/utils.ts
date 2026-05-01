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

/**
 * 한국식 날짜 포맷.
 * - full (기본): "2026년 5월 1일"
 * - short: "5월 1일"
 * - shortWithDow: "5월 1일 (금)"
 * - withTime: "5월 1일 14:30"
 * - date: "2026.05.01" (테이블/PDF용 컴팩트)
 */
type DateInput = string | number | Date | null | undefined;
type DateMode = "full" | "short" | "shortWithDow" | "withTime" | "date";

export function formatKoreanDate(input: DateInput, mode: DateMode = "full"): string {
  if (input == null || input === "") return "-";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  if (mode === "short") return `${m}월 ${day}일`;
  if (mode === "shortWithDow") return `${m}월 ${day}일 (${dow})`;
  if (mode === "withTime") {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${m}월 ${day}일 ${hh}:${mm}`;
  }
  if (mode === "date") {
    return `${y}.${String(m).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
  }
  return `${y}년 ${m}월 ${day}일`;
}
