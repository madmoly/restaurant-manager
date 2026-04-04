/** 숫자를 000,000 형식 문자열로 변환 */
export function fmtNum(v: number | string): string {
  const n = typeof v === 'string' ? parseInt(v.replace(/[^0-9-]/g, '') || '0', 10) : Math.round(v);
  return n.toLocaleString('ko-KR');
}

/** 콤마 포함 문자열 → 정수 */
export function parseNum(v: string): number {
  return parseInt(v.replace(/[^0-9-]/g, '') || '0', 10);
}

/** 금액 입력용: 숫자만 허용 + 콤마 포맷 반환 */
export function handleWonInput(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return parseInt(digits, 10).toLocaleString('ko-KR');
}

/** ISO 타임스탬프 → "HH:mm" 요약 */
export function fmtTs(raw: string | Date | null | undefined): string {
  if (!raw) return '-';
  try {
    const d = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(d.getTime())) return typeof raw === 'string' ? raw : '-';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return typeof raw === 'string' ? raw : '-';
  }
}

/** 날짜 요약: 년도 생략, 필요 시 뒷 2자리만. "3/27" 또는 "3/27(목)" */
export function fmtShortDate(raw: string | Date | null | undefined, withDay = false): string {
  if (!raw) return '-';
  const d = typeof raw === 'string' ? new Date(raw.length === 10 ? raw + 'T00:00:00' : raw) : raw;
  if (isNaN(d.getTime())) return typeof raw === 'string' ? raw : '-';
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (withDay) return `${m}/${day}(${dayNames[d.getDay()]})`;
  return `${m}/${day}`;
}

/** 근무유형 라벨: shiftPreset + 반차 여부 → "풀타임", "오픈반차" 등 */
export function getShiftLabel(preset: string | null | undefined, isHalf: boolean): string {
  switch (preset) {
    case 'full':  return isHalf ? '반차' : '풀타임';
    case 'open':  return isHalf ? '오픈반차' : '오픈';
    case 'close': return isHalf ? '마감반차' : '마감';
    default:      return isHalf ? '반차' : '커스텀';
  }
}

export const TAB_LABELS: Record<string, string> = {
  open: '오픈',
  purchase: '매입',
  midday: '일간보고',
  close: '마감',
};

export const UNIT_OPTIONS = ['개', '박스', 'kg', 'g', '리터', 'ml', '팩', '봉', '병', '캔', '포', '판', '줄', '묶음', '단', 'EA', '직접입력'];

export const SHIFT_LABELS: Record<string, string> = { open: '오픈', close: '마감', full: '풀타임' };

export interface PurchaseItemRow {
  rawItemName: string;
  spec?: string;
  originalName?: string;
  quantity: string;
  unitName: string;
  unitPrice: string;
  lineTotal: string;
  counterpartyItemId?: number;
  confidence?: string;
  matchedItemId?: number;
  matchedItemName?: string;
  itemCandidates?: { itemId: number; itemName: string; score: number; source: string }[];
}

export function emptyPurchaseItem(): PurchaseItemRow {
  return { rawItemName: '', quantity: '', unitName: '개', unitPrice: '', lineTotal: '' };
}

export type PurchaseInputMode = 'none' | 'order' | 'receive' | 'expense';

export interface OtherItem {
  itemName: string;
  amount: number;
}

export interface SpecialItem {
  typeName: string;
  amount: number;
  note?: string;
}

export type TabType = 'open' | 'purchase' | 'midday' | 'close';
