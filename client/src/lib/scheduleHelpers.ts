import { Sun, Moon, Maximize2 } from "lucide-react";

/**
 * 임시근로자 표시명 — 동명이인 구분 꼬리표를 결합한다.
 * 식별은 (매장, 이름, 꼬리표) 조합. 서버 집계도 같은 규칙으로 표시명을 만든다.
 */
export function tempDisplayName(name: string | null | undefined, tag: string | null | undefined) {
  if (!name) return null;
  return tag ? `${name} (${tag})` : name;
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export type ScheduleItem = {
  id: number;
  userId: number | null;
  tempWorkerName: string | null;
  tempWorkerTag: string | null;
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
  const day = d.getDay(); // 일=0
  const start = new Date(d);
  start.setDate(d.getDate() - day); // 그 주 일요일로 되돌림
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(start);
    dd.setDate(start.getDate() + i);
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

/**
 * 압축 시간 범위: 정시는 분 생략 — "10:00~15:00" → "10~15시", "10:30~15:00" → "10:30~15시".
 * 종료가 정시가 아니면 "시" 접미사 생략 ("10~15:30").
 */
export function fmtRangeCompact(start: Date | string, end: Date | string): string {
  const part = (d: Date | string) => {
    const date = typeof d === "string" ? new Date(d) : d;
    const h = date.getHours();
    const m = date.getMinutes();
    return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
  };
  const endDate = typeof end === "string" ? new Date(end) : end;
  const suffix = endDate.getMinutes() === 0 ? "시" : "";
  return `${part(start)}~${part(end)}${suffix}`;
}

const WEEK_ORDINALS = ["첫째주", "둘째주", "셋째주", "넷째주", "다섯째주"];

/**
 * 주차 서수 라벨: 해당 주 일요일이 속한 달 기준, 그 달의 n번째 일요일 = n째주.
 * 일요일이 8/31이고 나머지 요일이 9월이어도 "8월 다섯째주".
 */
export function weekOrdinalLabel(weekStart: Date): string {
  const n = Math.ceil(weekStart.getDate() / 7);
  return `${weekStart.getMonth() + 1}월 ${WEEK_ORDINALS[n - 1] ?? `${n}째주`}`;
}

/** 주 시작일이 일요일이므로 그리드 인덱스 0(일)·6(토)이 주말 */
export function isWeekendIndex(i: number): boolean {
  return i === 0 || i === 6;
}

// ─── 날짜 셀 근무 칩 정렬 ─────────────────────────────────────────────────────

/** 매장 내 직급 서열. 값이 클수록 상단. 레거시 store_manager·manager는 supervisor 급. */
export const STORE_ROLE_RANK: Record<string, number> = {
  owner: 3,
  supervisor: 2,
  store_manager: 2,
  manager: 2,
  staff: 1,
};

/** 실근무 분 = (퇴근 - 출근) - 휴게. 정렬 전용(급여 계산에 쓰지 말 것). */
export function scheduleWorkMinutes(s: { startTime: string | Date; endTime: string | Date; breakMinutes: number | null }): number {
  const start = new Date(s.startTime).getTime();
  const end = new Date(s.endTime).getTime();
  if (!isFinite(start) || !isFinite(end)) return 0;
  const span = Math.max(0, Math.round((end - start) / 60000));
  return Math.max(0, span - (s.breakMinutes ?? 0));
}

/**
 * 날짜 셀 근무 칩 정렬 비교자 생성.
 * 순서: 정규직원 먼저 → 실근무 긴 순 → 직급 높은 순 → 이름 가나다 → id(완전 결정성)
 */
export function makeChipComparator(roleByUserId: Map<number, string>) {
  return (a: ScheduleItem, b: ScheduleItem): number => {
    const aTemp = a.userId == null ? 1 : 0;
    const bTemp = b.userId == null ? 1 : 0;
    if (aTemp !== bTemp) return aTemp - bTemp;

    const aw = scheduleWorkMinutes(a);
    const bw = scheduleWorkMinutes(b);
    if (aw !== bw) return bw - aw;

    const aRank = a.userId != null ? (STORE_ROLE_RANK[roleByUserId.get(a.userId) ?? ""] ?? 0) : 0;
    const bRank = b.userId != null ? (STORE_ROLE_RANK[roleByUserId.get(b.userId) ?? ""] ?? 0) : 0;
    if (aRank !== bRank) return bRank - aRank;

    const aName = a.userName ?? tempDisplayName(a.tempWorkerName, a.tempWorkerTag) ?? "";
    const bName = b.userName ?? tempDisplayName(b.tempWorkerName, b.tempWorkerTag) ?? "";
    const byName = aName.localeCompare(bName, "ko");
    if (byName !== 0) return byName;

    return a.id - b.id;
  };
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

export const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

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

// ─── 프리셋 라벨 / headcount 가중치 ──────────────────────────────────────────────

export function resolvePresetLabel(preset: string | null, shiftPresets?: any[]): string {
  if (!preset) return "";
  const db = shiftPresets?.find((p: any) => p.presetType === preset);
  if (db?.label) return db.label;
  return DEFAULT_PRESET_LABELS[preset]?.label ?? preset;
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * 근로기준법 §54 기반 휴게 기본값: 8h 이상 60분, 4h 이상 30분, 미만 0분.
 * 서버 동일 규칙: server/helpers/labor.ts defaultBreakMinutes — 변경 시 양쪽 동기 필수.
 */
export function defaultBreakMinutes(grossHours: number): number {
  if (grossHours >= 8) return 60;
  if (grossHours >= 4) return 30;
  return 0;
}

// 인원 가중치는 의도적으로 gross(휴게 미차감) 체류시간 기준 — 휴게 중에도 매장 체류 인원으로 본다
export function calcHeadcountWeight(
  startTime: string | Date,
  endTime: string | Date,
  openTime: string | null | undefined,
  closeTime: string | null | undefined,
  halfShiftThreshold: number | null | undefined,
): number {
  const st = startTime instanceof Date ? startTime : new Date(startTime);
  const et = endTime instanceof Date ? endTime : new Date(endTime);
  const workMinutes = (et.getTime() - st.getTime()) / 60000;
  if (workMinutes <= 0) return 1;

  const open = openTime ? timeToMinutes(openTime) : 0;
  const close = closeTime ? timeToMinutes(closeTime) : 1440;
  const storeMinutes = close > open ? close - open : 1440 - open + close;
  if (storeMinutes <= 0) return 1;

  const ratio = (workMinutes / storeMinutes) * 100;
  const threshold = halfShiftThreshold ?? 60;
  return ratio < threshold ? 0.5 : 1;
}
