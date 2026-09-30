import { describe, it, expect } from "vitest";
import { parseExpenseText, markDuplicates, resolveDate } from "../shared/expenseTextParser";

const CATS = ["인터넷발주", "수리/보수", "소모품", "배달비", "기타"];
const TODAY = "2026-09-30";

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
  const r = parseExpenseText(SAMPLE, TODAY, CATS);

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
    expect(r.storeCandidate).toBe("천호점");
    expect(r.rows[0]).toMatchObject({ category: "인터넷발주", amount: 45000, memo: "쿠팡 세제" });
    expect(r.rows[1]).toMatchObject({ amount: 12300, memo: "다이소 수세미" });
  });
  it("파싱 실패 줄은 원문 그대로 errors", () => {
    const e = parseExpenseText("9/1 금액없음\n13/40 500 x\n아주아주아주아주아주 긴 설명 줄입니다 정말로", TODAY, CATS);
    expect(e.rows).toHaveLength(0);
    expect(e.errors).toEqual(["9/1 금액없음", "13/40 500 x", "아주아주아주아주아주 긴 설명 줄입니다 정말로"]);
  });
  it("품목에 숫자가 있어도 금액 오인 안 함", () => {
    const x = parseExpenseText("9/1 세제 2개 15,000원", TODAY, CATS);
    expect(x.rows[0]).toMatchObject({ amount: 15000, memo: "세제 2개" });
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
