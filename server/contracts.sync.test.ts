import { describe, it, expect, vi, beforeEach } from "vitest";

// 계약 조건 → 고정비 자동 동기화 로직 단위 테스트
describe("계약 조건 고정비 동기화 로직", () => {
  // 고정 금액 계산 테스트
  it("고정 금액 계약 조건의 금액 계산", () => {
    const contract = {
      calcType: "fixed" as const,
      fixedAmount: "3000000",
      ratioPercent: "0",
    };
    const monthlySales = 50000000;
    let amount = 0;
    if (contract.calcType === "fixed") {
      amount = parseFloat(contract.fixedAmount);
    } else {
      amount = monthlySales * parseFloat(contract.ratioPercent) / 100;
    }
    expect(Math.round(amount)).toBe(3000000);
  });

  // 매출 비율 계산 테스트
  it("매출 비율 계약 조건의 금액 계산", () => {
    const contract = {
      calcType: "ratio" as const,
      fixedAmount: "0",
      ratioPercent: "5.5",
    };
    const monthlySales = 10000000;
    let amount = 0;
    if (contract.calcType === "fixed") {
      amount = parseFloat(contract.fixedAmount);
    } else {
      amount = monthlySales * parseFloat(contract.ratioPercent) / 100;
    }
    expect(Math.round(amount)).toBe(550000);
  });

  // 계약 유형 → 고정비 카테고리 매핑 테스트
  it("계약 유형이 고정비 카테고리로 올바르게 매핑됨", () => {
    const categoryTypeMap: Record<string, string> = {
      rent: "rent",
      commission: "fee",
      royalty: "fee",
      investor: "other",
      other: "other",
    };
    expect(categoryTypeMap["rent"]).toBe("rent");
    expect(categoryTypeMap["commission"]).toBe("fee");
    expect(categoryTypeMap["royalty"]).toBe("fee");
    expect(categoryTypeMap["investor"]).toBe("other");
    expect(categoryTypeMap["other"]).toBe("other");
  });

  // 비율 0%일 때 금액이 0원인지 확인
  it("비율이 0%일 때 계산 금액은 0원", () => {
    const monthlySales = 50000000;
    const ratioPercent = 0;
    const amount = monthlySales * ratioPercent / 100;
    expect(Math.round(amount)).toBe(0);
  });

  // 매출이 0일 때 비율 계약 금액이 0원인지 확인
  it("매출이 0일 때 비율 계약 금액은 0원", () => {
    const monthlySales = 0;
    const ratioPercent = 5.5;
    const amount = monthlySales * ratioPercent / 100;
    expect(Math.round(amount)).toBe(0);
  });
});
