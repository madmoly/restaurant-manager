/**
 * 즉시지출 텍스트 일괄입력 파서. 서버·클라이언트 공용 순수함수(DB 무관).
 *
 * 입력 예:
 *   천호점
 *   인터넷발주
 *   9/25 쿠팡 세제 45,000원
 *   ———
 *   9/26 12,000 택배비
 *
 * 규칙
 * - 날짜로 시작하지 않는 짧은 줄 = 헤더.
 *   · 카테고리명과 일치 → 현재 카테고리
 *   · 선택 매장명과 부분일치 → 매장명 후보(storeCandidate)
 *   · 그 외 → 없는 카테고리 헤더로 보고 현재 카테고리를 null로 두고 warnings에 "카테고리 없음: X"
 * - 구분선(— - = 3자 이상)은 카테고리를 미지정(null)으로 리셋한다. 상속하지 않는다.
 * - 연도는 기준일 이하 가장 가까운 날짜로 추정한다.
 * - 파싱 실패 줄은 errors에 원문 그대로 담는다.
 */

/** prepaid: 사전결제·충전 / duplicate: DB 기존건과 날짜·금액 동일 / batchDuplicate: 입력 내 동일 날짜·금액 */
export type ExpenseFlag = "prepaid" | "duplicate" | "batchDuplicate";

export interface ParsedExpenseRow {
  /** YYYY-MM-DD */
  date: string;
  amount: number;
  memo: string;
  /** 카테고리명(전달받은 목록의 표기 그대로). 미지정이면 null */
  category: string | null;
  flags: ExpenseFlag[];
}

export interface ParsedExpenseText {
  rows: ParsedExpenseRow[];
  errors: string[];
  warnings: string[];
  storeCandidate: string | null;
}

const DATE_LINE = /^(\d{1,2})\/(\d{1,2})\s+(.+)$/;
const DIVIDER = /^[—–\-=_]{3,}$/;
const PREPAID = /사전결제|선결제|충전/;
const HEADER_MAX_LEN = 30;
// 금액: 쉼표 포함(66,100) 또는 원 접미(5000원)면 "강한" 금액 — 품목에 붙어 있어도 인정.
// 쉼표·원 없는 순수 숫자는 공백으로 분리돼 있을 때만 금액으로 본다(예: "3M테이프" 오인 방지).
const LEAD_AMOUNT = /^(\d{1,3}(?:,\d{3})+(?![\d,])원?|\d+원)\s*(\S.*)$|^(\d+)\s+(\S.*)$/;
const TRAIL_AMOUNT = /^(.*[^\d,])\s*(\d{1,3}(?:,\d{3})+원?|\d+원)$|^(.*\S)\s+(\d+)$/;

const normalizeName = (s: string) =>
  s.replace(/[\s:：\[\]()【】#*]/g, "").toLowerCase();

const pad = (n: number) => String(n).padStart(2, "0");

/** 기준일(YYYY-MM-DD) 이하에서 가장 가까운 month/day의 날짜. 존재하지 않는 날짜면 null */
export function resolveDate(month: number, day: number, today: string): string | null {
  const [ty, tm, td] = today.split("-").map(Number);
  const valid = (y: number) => {
    const d = new Date(Date.UTC(y, month - 1, day));
    return d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  };
  let year = month > tm || (month === tm && day > td) ? ty - 1 : ty;
  // 2/29 등: 해당 연도에 없으면 더 과거의 윤년까지 거슬러 찾는다
  for (let i = 0; i < 8 && !valid(year); i++) year--;
  return valid(year) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** 금액과 품목을 분리. 금액이 앞/뒤 어느 쪽이든, 품목에 붙어 있어도 허용. 실패 시 null */
export function splitAmountAndMemo(rest: string): { amount: number; memo: string } | null {
  const text = rest.trim();
  const lead = LEAD_AMOUNT.exec(text);
  const trail = TRAIL_AMOUNT.exec(text);
  const leadAmt = lead ? (lead[1] ?? lead[3]) : null;
  const trailAmt = trail ? (trail[2] ?? trail[4]) : null;
  const isStrong = (t: string | null) => !!t && /,|원$/.test(t);

  let amountTok: string;
  let memo: string;
  if (leadAmt && (!trailAmt || (isStrong(leadAmt) && !isStrong(trailAmt)))) {
    amountTok = leadAmt;
    memo = lead![2] ?? lead![4];
  } else if (trailAmt) {
    amountTok = trailAmt;
    memo = trail![1] ?? trail![3];
  } else {
    return null;
  }
  const amount = Number(amountTok.replace(/[,원]/g, ""));
  memo = memo.trim();
  if (!memo || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount, memo };
}

/**
 * 헤더가 선택 매장명을 가리키는지. 매장명(공백·끝 "점" 제거)의 끝부분 2자 이상이 헤더에 포함되면 일치.
 * 예) 매장 "청계산뚝배기수제비천호점" · 헤더 "청계산 뚝배기 천호 법카주문" → "천호" 포함 → 일치
 */
export function headerMatchesStore(header: string, storeName: string): boolean {
  const h = header.replace(/\s/g, "");
  const s = storeName.replace(/\s/g, "").replace(/점$/, "");
  if (s.length < 2) return false;
  for (let len = s.length; len >= 2; len--) {
    if (h.includes(s.slice(s.length - len))) return true;
  }
  return false;
}

export function parseExpenseText(
  text: string,
  today: string,
  categoryNames: string[],
  storeName?: string | null,
): ParsedExpenseText {
  const catByNorm = new Map(categoryNames.map((n) => [normalizeName(n), n]));
  const rows: ParsedExpenseRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let storeCandidate: string | null = null;
  let category: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (DIVIDER.test(line)) {
      category = null;
      continue;
    }

    const m = DATE_LINE.exec(line);
    if (m) {
      const date = resolveDate(Number(m[1]), Number(m[2]), today);
      const parts = splitAmountAndMemo(m[3]);
      if (!date || !parts) {
        errors.push(raw.trim());
        continue;
      }
      rows.push({
        date,
        amount: parts.amount,
        memo: parts.memo,
        category,
        flags: PREPAID.test(line) ? ["prepaid"] : [],
      });
      continue;
    }

    // 날짜 없는 줄: 짧으면 헤더, 아니면 오류
    if (line.length <= HEADER_MAX_LEN) {
      const matched = catByNorm.get(normalizeName(line));
      if (matched) {
        category = matched;
      } else if (storeName && storeCandidate === null && headerMatchesStore(line, storeName)) {
        storeCandidate = line;
      } else {
        // 없는 카테고리 헤더: 이전 카테고리를 상속하지 않고 미지정으로 둔다
        category = null;
        warnings.push(`카테고리 없음: ${line}`);
      }
    } else {
      errors.push(line);
    }
  }

  return { rows, errors, warnings, storeCandidate };
}

/** 기존 건(날짜·금액 동일)과 겹치는 행에 duplicate 플래그를 붙인다 */
export function markDuplicates<T extends { date: string; amount: number; flags: ExpenseFlag[] }>(
  rows: T[],
  existing: { date: string; amount: number }[],
): T[] {
  const seen = new Set(existing.map((e) => `${e.date}|${Math.round(e.amount)}`));
  return rows.map((r) =>
    seen.has(`${r.date}|${Math.round(r.amount)}`) && !r.flags.includes("duplicate")
      ? { ...r, flags: [...r.flags, "duplicate" as const] }
      : r,
  );
}

/**
 * 입력(batch) 안에서 날짜·금액이 같은 행끼리 batchDuplicate 플래그를 붙인다.
 * 표시용일 뿐 기본 체크 해제 대상은 아니다(같은 날 같은 금액의 정상 지출이 흔함).
 */
export function markBatchDuplicates<T extends { date: string; amount: number; flags: ExpenseFlag[] }>(rows: T[]): T[] {
  const count = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.date}|${Math.round(r.amount)}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return rows.map((r) =>
    (count.get(`${r.date}|${Math.round(r.amount)}`) ?? 0) > 1 && !r.flags.includes("batchDuplicate")
      ? { ...r, flags: [...r.flags, "batchDuplicate" as const] }
      : r,
  );
}
