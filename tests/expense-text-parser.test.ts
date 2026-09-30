import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  parseExpenseText,
  markDuplicates,
  markBatchDuplicates,
  resolveDate,
  headerMatchesStore,
} from "../shared/expenseTextParser";
import { toDailyExpenseInsertValues } from "../server/helpers/expenseBulk";
import { dailyExpenses } from "../drizzle/schema";

const CATS = ["인터넷발주", "수리/보수", "소모품", "배달비", "기타"];
const TODAY = "2026-09-30";

// ── 주 케이스: 천호점 실샘플 (원문 그대로) ──
// 천호점(RID=2) 매장명과 prod expense_categories (2026-09-30 SELECT 결과) 기준
const CHEONHO_STORE = "청계산뚝배기수제비천호점";
const CHEONHO_CATS = ["인터넷발주", "수리/보수", "소모품", "배달비", "기타"];
const REAL_SAMPLE = `청계산 뚝배기 천호 법카주문

식자재
9/4 66,100백합, 양파후레이크
9/5 54,060 둥글래차
9/5 58,370 백합, 세제
9/10 38,500 백합
9/14 38,500 백합
9/15 74,000 백합, 후추그라인더

잡비
9/5 115,000 밥솥 당근구매
9/4 사전결제 1,500,000원
9/15 8,900 자외선 소독기 램프구매
9/18 37,400 영수증용지
9/18 26,000 양피후레이크
—————————————-

9/26 63,820 양파후레이크, 백합`;

describe("parseExpenseText — 천호점 실샘플", () => {
  const r = parseExpenseText(REAL_SAMPLE, TODAY, CHEONHO_CATS, CHEONHO_STORE);

  it("12건 파싱, 오류 0", () => {
    expect(r.rows).toHaveLength(12);
    expect(r.errors).toEqual([]);
  });
  it("공백 없이 붙은 금액: 66,100백합 → 66100 / 백합, 양파후레이크", () => {
    expect(r.rows[0]).toMatchObject({ date: "2026-09-04", amount: 66100, memo: "백합, 양파후레이크" });
  });
  it("금액이 품목 뒤: 9/4 사전결제 1,500,000원 → prepaid", () => {
    const pre = r.rows.filter((x) => x.flags.includes("prepaid"));
    expect(pre).toHaveLength(1);
    expect(pre[0]).toMatchObject({ date: "2026-09-04", amount: 1500000, memo: "사전결제" });
  });
  it("매장 헤더만 storeCandidate, 선택 매장과 일치", () => {
    expect(r.storeCandidate).toBe("청계산 뚝배기 천호 법카주문");
    expect(headerMatchesStore("청계산 뚝배기 천호 법카주문", CHEONHO_STORE)).toBe(true);
    expect(headerMatchesStore("청계산 뚝배기 잠실 법카주문", CHEONHO_STORE)).toBe(false);
  });
  it("식자재·잡비는 카테고리 헤더로 인식 — 현 매장에 없으므로 전건 null + 경고", () => {
    expect(r.warnings).toEqual(["카테고리 없음: 식자재", "카테고리 없음: 잡비"]);
    expect(r.rows.every((x) => x.category === null)).toBe(true);
  });
  it("식자재·잡비 카테고리가 있다면: 매칭되고 구분선 뒤 9/26 1건만 null", () => {
    const r2 = parseExpenseText(REAL_SAMPLE, TODAY, [...CHEONHO_CATS, "식자재", "잡비"], CHEONHO_STORE);
    expect(r2.warnings).toEqual([]);
    expect(r2.rows.filter((x) => x.category === "식자재")).toHaveLength(6);
    expect(r2.rows.filter((x) => x.category === "잡비")).toHaveLength(5);
    const nulls = r2.rows.filter((x) => x.category === null);
    expect(nulls).toHaveLength(1);
    expect(nulls[0]).toMatchObject({ date: "2026-09-26", amount: 63820, memo: "양파후레이크, 백합" });
  });
});

// ── 보조 케이스: 대체 샘플 ──

// 사용자 원본 샘플이 전달되지 않아 명세(12건 / 9·26건 미지정 / 사전결제 / 오류 0)에 맞춰 구성한 대체 샘플
const SAMPLE = `천호점
인터넷발주
9/1 쿠팡 세제 45,000원
9/2 12,300 다이소 수세미
9/3 오늘의집 선반 89,000
수리/보수
9/5 화장실 수리 150,000원
9/8 배관 청소 80,000
소모품
9/10 위생장갑 22,000원
9/12 종이컵 사전결제 33,000원
9/15 냅킨 18,500원
———
9/26 택배비 4,000원
기타
9/27 배달앱 충전 100,000원
9/28 주방 매트 27,000
———
9/26 정체불명 지출 5,500원`;

describe("parseExpenseText", () => {
  const r = parseExpenseText(SAMPLE, TODAY, CATS, "천호점");

  it("12건 파싱, 오류 0", () => {
    expect(r.rows).toHaveLength(12);
    expect(r.errors).toEqual([]);
  });
  it("구분선 뒤 9/26 건은 category=null (상속 금지)", () => {
    const nulls = r.rows.filter((x) => x.category === null);
    expect(nulls.map((x) => x.date)).toEqual(["2026-09-26", "2026-09-26"]);
  });
  it("사전결제·충전 flag=prepaid", () => {
    expect(r.rows.filter((x) => x.flags.includes("prepaid")).map((x) => x.memo)).toEqual([
      "종이컵 사전결제",
      "배달앱 충전",
    ]);
  });
  it("매장명 후보, 카테고리 매칭, 금액 앞/뒤 순서", () => {
    expect(r.warnings).toEqual([]);
    expect(r.storeCandidate).toBe("천호점");
    expect(r.rows[0]).toMatchObject({ category: "인터넷발주", amount: 45000, memo: "쿠팡 세제" });
    expect(r.rows[1]).toMatchObject({ amount: 12300, memo: "다이소 수세미" });
  });
  it("파싱 실패 줄은 원문 그대로 errors", () => {
    const long = "아주아주아주아주아주 긴 설명 줄입니다 정말로 헤더라고 보기엔 너무 김";
    const e = parseExpenseText(`9/1 금액없음\n13/40 500 x\n${long}`, TODAY, CATS);
    expect(e.rows).toHaveLength(0);
    expect(e.errors).toEqual(["9/1 금액없음", "13/40 500 x", long]);
  });
  it("품목에 숫자가 있어도 금액 오인 안 함", () => {
    const x = parseExpenseText("9/1 세제 2개 15,000원\n9/1 3M테이프 5,000", TODAY, CATS);
    expect(x.rows[0]).toMatchObject({ amount: 15000, memo: "세제 2개" });
    expect(x.rows[1]).toMatchObject({ amount: 5000, memo: "3M테이프" });
  });
});

describe("resolveDate", () => {
  it("기준일 이후 월일은 전년도", () => {
    expect(resolveDate(10, 2, "2026-09-30")).toBe("2025-10-02");
    expect(resolveDate(9, 30, "2026-09-30")).toBe("2026-09-30");
    expect(resolveDate(1, 5, "2026-09-30")).toBe("2026-01-05");
  });
  it("존재하지 않는 날짜는 null", () => {
    expect(resolveDate(2, 30, "2026-09-30")).toBeNull();
  });
});

describe("markDuplicates", () => {
  it("같은 날짜·금액 기존건이 있으면 duplicate (2회차 전건 표시)", () => {
    const rows = parseExpenseText(SAMPLE, TODAY, CATS).rows;
    const once = markDuplicates(rows, []);
    expect(once.some((x) => x.flags.includes("duplicate"))).toBe(false);
    const twice = markDuplicates(rows, rows);
    expect(twice.every((x) => x.flags.includes("duplicate"))).toBe(true);
  });
});

describe("markBatchDuplicates — 입력 내부 중복", () => {
  it("DB와 무관하게 같은 입력 안의 동일 날짜·금액 행에 batchDuplicate만 붙인다", () => {
    const rows = parseExpenseText("9/10 38,500 백합\n9/10 38,500 백합\n9/14 38,500 백합", TODAY, CATS).rows;
    const marked = markBatchDuplicates(rows);
    expect(marked.map((x) => x.flags)).toEqual([["batchDuplicate"], ["batchDuplicate"], []]);
    // DB 중복(duplicate)과는 별개 플래그 — UI 기본 체크 해제 대상 아님
    expect(marked.some((x) => x.flags.includes("duplicate"))).toBe(false);
  });
  it("실샘플에는 입력 내 동일 날짜·금액이 없다 (9/10·9/14 38,500은 날짜 다름)", () => {
    const rows = parseExpenseText(REAL_SAMPLE, TODAY, CHEONHO_CATS, CHEONHO_STORE).rows;
    expect(markBatchDuplicates(rows).some((x) => x.flags.includes("batchDuplicate"))).toBe(false);
  });
});

describe("bulkCreate insert 값 — 날짜·필드 동등성", () => {
  const catNames = new Map([[1, "인터넷발주"]]);
  const values = toDailyExpenseInsertValues(2, 7, [{ date: "2026-09-04", categoryId: 1, title: "백합", amount: 66100 }], catNames);

  it("단건 create와 같은 컬럼을 채운다", () => {
    expect(values[0]).toEqual({
      restaurantId: 2,
      date: "2026-09-04",
      categoryId: 1,
      category: "인터넷발주",
      title: "백합",
      amount: "66100",
      note: null,
      attachmentUrl: null,
      createdBy: 7,
    });
  });
  it("9/4 입력 → SQL 파라미터가 '2026-09-04' 문자열 (Date 객체 경유 없음)", () => {
    const pool = mysql.createPool({ uri: "mysql://u:p@127.0.0.1:1/x" }); // 연결하지 않음 — SQL 생성만
    const q = drizzle(pool).insert(dailyExpenses).values(values as any).toSQL();
    // insert into `t` (`id`, `restaurantId`, `date`, ...) values (default, ?, ?, ...) — default 칸은 param 없음
    const [head, tail] = q.sql.split(" values ");
    const cols = head.match(/\(([^)]*)\)/)![1].split(",").map((c) => c.trim().replace(/`/g, ""));
    const slots = tail.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim());
    let p = -1;
    const paramIdx = slots.map((v) => (v === "?" ? ++p : -1));
    const dateParam = q.params[paramIdx[cols.indexOf("date")]];
    expect(dateParam).toBe("2026-09-04");
    expect(dateParam instanceof Date).toBe(false);
    pool.end();
  });
});
