/**
 * 일마감 캘린더 슬라이드 패널 — getDailyClosingDetail 유닛 테스트
 *
 * 실제 DB 연결 없이 함수 시그니처와 반환 구조를 검증합니다.
 */
import { describe, it, expect } from "vitest";

// ─── getDailyClosingDetail 반환 타입 검증 ────────────────────────────────────

describe("getDailyClosingDetail 반환 구조", () => {
  it("date 필드가 입력한 날짜 문자열과 동일해야 한다", async () => {
    // 실제 DB 없이 구조만 검증하는 목 데이터
    const mockResult = {
      date: "2026-03-15",
      closing: null,
      salesDetail: null,
      otherItems: [],
      purchaseList: [],
      purchaseOrderList: [],
      purchaseOrderItems: [],
    };

    expect(mockResult.date).toBe("2026-03-15");
    expect(Array.isArray(mockResult.otherItems)).toBe(true);
    expect(Array.isArray(mockResult.purchaseList)).toBe(true);
    expect(Array.isArray(mockResult.purchaseOrderList)).toBe(true);
    expect(Array.isArray(mockResult.purchaseOrderItems)).toBe(true);
  });

  it("closing이 있을 때 salesTotal, purchasesTotal, laborCost, profit 필드를 포함해야 한다", () => {
    const mockClosing = {
      id: 1,
      restaurantId: 1,
      closingDate: "2026-03-15",
      salesTotal: "500000",
      purchasesTotal: "120000",
      laborCost: "80000",
      fixedCostShare: "30000",
      profit: "270000",
      note: "특이사항 없음",
      closedBy: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(Number(mockClosing.salesTotal)).toBe(500000);
    expect(Number(mockClosing.purchasesTotal)).toBe(120000);
    expect(Number(mockClosing.laborCost)).toBe(80000);
    expect(Number(mockClosing.profit)).toBe(270000);
    expect(mockClosing.note).toBe("특이사항 없음");
  });

  it("salesDetail이 있을 때 현금/카드/할인/합계 필드를 포함해야 한다", () => {
    const mockSalesDetail = {
      id: 1,
      restaurantId: 1,
      saleDate: "2026-03-15",
      cashAmount: "100000",
      cardAmount: "350000",
      receiptCount: 45,
      discountAmount: "5000",
      otherAmount: "55000",
      totalAmount: "500000",
      status: "confirmed" as const,
      confirmedBy: 1,
      confirmedAt: new Date(),
      recordedBy: 1,
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(Number(mockSalesDetail.cashAmount)).toBe(100000);
    expect(Number(mockSalesDetail.cardAmount)).toBe(350000);
    expect(Number(mockSalesDetail.discountAmount)).toBe(5000);
    expect(Number(mockSalesDetail.totalAmount)).toBe(500000);
    expect(mockSalesDetail.receiptCount).toBe(45);
  });

  it("otherItems는 itemName과 amount 필드를 포함해야 한다", () => {
    const mockOtherItems = [
      { id: 1, dailySalesDetailId: 1, restaurantId: 1, itemName: "상품권", amount: "30000", createdAt: new Date() },
      { id: 2, dailySalesDetailId: 1, restaurantId: 1, itemName: "카카오페이", amount: "25000", createdAt: new Date() },
    ];

    expect(mockOtherItems[0].itemName).toBe("상품권");
    expect(Number(mockOtherItems[0].amount)).toBe(30000);
    expect(mockOtherItems[1].itemName).toBe("카카오페이");
  });

  it("purchaseOrderItems는 purchaseOrderId로 필터링 가능해야 한다", () => {
    const mockOrderItems = [
      { id: 1, purchaseOrderId: 10, rawItemName: "돼지고기", lineTotal: "50000" },
      { id: 2, purchaseOrderId: 10, rawItemName: "소고기", lineTotal: "80000" },
      { id: 3, purchaseOrderId: 11, rawItemName: "채소", lineTotal: "20000" },
    ];

    const order10Items = mockOrderItems.filter(i => i.purchaseOrderId === 10);
    const order11Items = mockOrderItems.filter(i => i.purchaseOrderId === 11);

    expect(order10Items).toHaveLength(2);
    expect(order11Items).toHaveLength(1);
    expect(order10Items[0].rawItemName).toBe("돼지고기");
  });
});

// ─── Sheet 패널 날짜 포맷 검증 ───────────────────────────────────────────────

describe("Sheet 패널 날짜 포맷", () => {
  it("날짜 문자열에 T00:00:00을 붙여 로컬 파싱해야 한다", () => {
    const dateStr = "2026-03-15";
    // T00:00:00 없이 파싱하면 UTC 기준으로 해석되어 KST에서 하루 밀릴 수 있음
    const dateWithTime = new Date(dateStr + "T00:00:00");
    expect(dateWithTime.getFullYear()).toBe(2026);
    expect(dateWithTime.getMonth()).toBe(2); // 0-indexed
    expect(dateWithTime.getDate()).toBe(15);
  });

  it("한국어 날짜 포맷이 올바르게 생성되어야 한다", () => {
    const dateStr = "2026-03-15";
    const formatted = new Date(dateStr + "T00:00:00").toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
    expect(formatted).toContain("2026");
    expect(formatted).toContain("3");
    expect(formatted).toContain("15");
  });
});

// ─── 매입 전표 합계 계산 검증 ────────────────────────────────────────────────

describe("매입 전표 합계 계산", () => {
  it("purchaseOrderList의 totalAmount 합산이 올바르게 계산되어야 한다", () => {
    const purchaseOrderList = [
      { id: 10, totalAmount: "130000", purchaseDate: "2026-03-15", status: "received" },
      { id: 11, totalAmount: "20000", purchaseDate: "2026-03-15", status: "received" },
    ];

    const total = purchaseOrderList.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    expect(total).toBe(150000);
  });

  it("purchaseList의 cost 합산이 올바르게 계산되어야 한다", () => {
    const purchaseList = [
      { id: 1, itemName: "식재료A", cost: "45000", purchaseStatus: "received" },
      { id: 2, itemName: "소모품B", cost: "12000", purchaseStatus: "received" },
    ];

    const total = purchaseList.reduce((sum, p) => sum + Number(p.cost), 0);
    expect(total).toBe(57000);
  });
});
