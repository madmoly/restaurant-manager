import { Sun, Moon, Maximize2 } from "lucide-react";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type ScheduleItem = {
  id: number;
  userId: number | null;
  tempWorkerName: string | null;
  tempWageType: string | null;
  tempWageAmount: string | null;
  userName: string | null;
  startTime: string | Date;
  endTime: string | Date;
  status: string;
  shiftPreset: string | null;
  breakMinutes: number | null;
  note: string | null;
  editReason: string | null;
  payrollRecheckRequired: boolean | null;
};

export type StaffItem = {
  userId: number;
  name: string;
  storeRole: string;
};

// ─── 헬퍼 함수 ────────────────────────────────────────────────────────────────

export function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    return dd;
  });
}

export function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fmtTime(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

export const DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"];

export const STATUS_LABELS: Record<string, { label: string; color: string; bgCard: string }> = {
  draft: {
    label: "초안",
    color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    bgCard: "border-l-gray-400",
  },
  confirmed: {
    label: "확정",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    bgCard: "border-l-blue-500",
  },
  completed: {
    label: "완료",
    color: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    bgCard: "border-l-green-500",
  },
  canceled: {
    label: "취소",
    color: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400",
    bgCard: "border-l-red-400",
  },
};

export const DEFAULT_PRESET_LABELS: Record<string, { label: string; icon: typeof Sun }> = {
  open: { label: "오픈", icon: Sun },
  close: { label: "마감", icon: Moon },
  full: { label: "풀타임", icon: Maximize2 },
  fullday: { label: "풀타임", icon: Maximize2 },
};

export const LEAVE_LABELS: Record<string, string> = {
  dayoff: "휴무",
  half_morning: "반차출근 (오전OFF)",
  half_evening: "반차퇴근 (오후OFF)",
};

export const REQ_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "대기", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  approved: { label: "승인", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  rejected: { label: "거절", color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" },
};

export const SHIFT_PRESET_DEFAULTS = [
  { value: "open", label: "오픈" },
  { value: "full", label: "풀타임" },
  { value: "close", label: "마감" },
] as const;

export const SHIFT_DAY_TYPES = [
  { value: "weekday", label: "평일" },
  { value: "weekend", label: "주말" },
] as const;
