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
 * - 날짜로 시작하지 않는 짧은 줄 = 헤더. 카테고리명과 일치하면 현재 카테고리, 아니면 매장명 후보.
 * - 구분선(— - = 3자 이상)은 카테고리를 미지정(null)으로 리셋한다. 상속하지 않는다.
 * - 연도는 기준일 이하 가장 가까운 날짜로 추정한다.
 * - 파싱 실패 줄은 errors에 원문 그대로 담는다.
 */

export type ExpenseFlag = "prepaid" | "duplicate";

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
  storeCandidate: string | null;
}

const DATE_LINE = /^(\d{1,2})\/(\d{1,2})\s+(.+)$/;
const DIVIDER = /^[—–\-=_]{3,}$/;
const PREPAID = /사전결제|선결제|충전/;
const AMOUNT_TOKEN = /^\d{1,3}(?:,\d{3})+원?$|^\d+원?$/;
const HEADER_MAX_LEN = 20;

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

/** 금액과 품목을 분리. 금액이 앞/뒤 어느 쪽이든 허용. 실패 시 null */
export function splitAmountAndMemo(rest: string): { amount: number; memo: string } | null {
  const tokens = rest.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const isStrong = (t: string) => /,|원$/.test(t);
  let pickFirst: boolean;
  if (AMOUNT_TOKEN.test(last) && AMOUNT_TOKEN.test(first)) pickFirst = isStrong(first) && !isStrong(last);
  else if (AMOUNT_TOKEN.test(last)) pickFirst = false;
  else if (AMOUNT_TOKEN.test(first)) pickFirst = true;
  else return null;

  const amountTok = pickFirst ? first : last;
  const memo = (pickFirst ? tokens.slice(1) : tokens.slice(0, -1)).join(" ").trim();
  const amount = Number(amountTok.replace(/[,원]/g, ""));
  if (!memo || !Number.isFinite(amount) || amount <= 0) return null;
  return { amount, memo };
}

export function parseExpenseText(
  text: string,
  today: string,
  categoryNames: string[],
): ParsedExpenseText {
  const catByNorm = new Map(categoryNames.map((n) => [normalizeName(n), n]));
  const rows: ParsedExpenseRow[] = [];
  const errors: string[] = [];
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
      if (matched) category = matched;
      else if (storeCandidate === null) storeCandidate = line;
      else errors.push(line);
    } else {
      errors.push(line);
    }
  }

  return { rows, errors, storeCandidate };
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
