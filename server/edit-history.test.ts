import { describe, it, expect } from "vitest";

// ─── EditHistoryEntry 타입 및 이력 기록 로직 단위 테스트 ───────────────────

type EditHistoryEntry = {
  userId: number;
  userName: string;
  at: string;
  summary: string;
};

/** 기존 이력에 새 항목을 추가하는 순수 함수 */
function appendEditHistory(
  existing: EditHistoryEntry[] | null | undefined,
  entry: EditHistoryEntry
): EditHistoryEntry[] {
  return [...(existing ?? []), entry];
}

/** editHistory JSON 컬럼에서 이력 파싱 */
function parseEditHistory(raw: unknown): EditHistoryEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as EditHistoryEntry[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

describe("EditHistory 유틸", () => {
  describe("appendEditHistory", () => {
    it("기존 이력이 없을 때 새 항목을 추가한다", () => {
      const entry: EditHistoryEntry = {
        userId: 1,
        userName: "홍길동",
        at: "2026-03-19T10:00:00.000Z",
        summary: "재마감 처리 — 메모: 카드 오류 수정",
      };
      const result = appendEditHistory(null, entry);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(entry);
    });

    it("기존 이력이 있을 때 항목을 누적한다", () => {
      const existing: EditHistoryEntry[] = [
        {
          userId: 1,
          userName: "홍길동",
          at: "2026-03-18T09:00:00.000Z",
          summary: "최초 마감",
        },
      ];
      const newEntry: EditHistoryEntry = {
        userId: 2,
        userName: "김매니저",
        at: "2026-03-19T10:00:00.000Z",
        summary: "재마감 처리",
      };
      const result = appendEditHistory(existing, newEntry);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual(newEntry);
    });

    it("빈 배열에서도 정상 동작한다", () => {
      const entry: EditHistoryEntry = {
        userId: 3,
        userName: "이점장",
        at: "2026-03-19T11:00:00.000Z",
        summary: "매출 수정",
      };
      const result = appendEditHistory([], entry);
      expect(result).toHaveLength(1);
    });

    it("기존 이력을 변경하지 않는다 (불변성)", () => {
      const existing: EditHistoryEntry[] = [
        { userId: 1, userName: "홍길동", at: "2026-03-18T09:00:00.000Z", summary: "최초" },
      ];
      const originalLength = existing.length;
      appendEditHistory(existing, {
        userId: 2,
        userName: "김매니저",
        at: "2026-03-19T10:00:00.000Z",
        summary: "추가",
      });
      expect(existing).toHaveLength(originalLength);
    });
  });

  describe("parseEditHistory", () => {
    it("null/undefined를 빈 배열로 파싱한다", () => {
      expect(parseEditHistory(null)).toEqual([]);
      expect(parseEditHistory(undefined)).toEqual([]);
    });

    it("배열을 그대로 반환한다", () => {
      const arr: EditHistoryEntry[] = [
        { userId: 1, userName: "홍길동", at: "2026-03-19T10:00:00.000Z", summary: "테스트" },
      ];
      expect(parseEditHistory(arr)).toEqual(arr);
    });

    it("JSON 문자열을 파싱한다", () => {
      const arr: EditHistoryEntry[] = [
        { userId: 1, userName: "홍길동", at: "2026-03-19T10:00:00.000Z", summary: "테스트" },
      ];
      expect(parseEditHistory(JSON.stringify(arr))).toEqual(arr);
    });

    it("잘못된 JSON 문자열을 빈 배열로 반환한다", () => {
      expect(parseEditHistory("invalid json")).toEqual([]);
    });

    it("배열이 아닌 JSON 객체를 빈 배열로 반환한다", () => {
      expect(parseEditHistory(JSON.stringify({ key: "value" }))).toEqual([]);
    });
  });

  describe("EditHistoryEntry 구조 검증", () => {
    it("필수 필드가 모두 있어야 한다", () => {
      const entry: EditHistoryEntry = {
        userId: 1,
        userName: "홍길동",
        at: new Date().toISOString(),
        summary: "재마감 처리",
      };
      expect(entry.userId).toBeTypeOf("number");
      expect(entry.userName).toBeTypeOf("string");
      expect(entry.at).toBeTypeOf("string");
      expect(entry.summary).toBeTypeOf("string");
    });

    it("at 필드는 ISO 8601 형식이어야 한다", () => {
      const at = new Date().toISOString();
      expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("여러 수정자의 이력을 순서대로 기록한다", () => {
      const history: EditHistoryEntry[] = [];
      const users = [
        { userId: 1, userName: "홍길동" },
        { userId: 2, userName: "김매니저" },
        { userId: 3, userName: "이점장" },
      ];
      users.forEach((u, i) => {
        const updated = appendEditHistory(history, {
          ...u,
          at: new Date(Date.now() + i * 1000).toISOString(),
          summary: `수정 ${i + 1}`,
        });
        history.push(...updated.slice(history.length));
      });
      expect(history).toHaveLength(3);
      expect(history.map((h) => h.userName)).toEqual(["홍길동", "김매니저", "이점장"]);
    });
  });
});

describe("과거 날짜 매출 입력 허용 로직", () => {
  /** 점장 이상이거나 과거 날짜이면 시간 제한을 우회하는 로직 */
  function shouldBypassTimeRestriction(params: {
    isManager: boolean;
    saleDate: string;
    todayStr: string;
  }): boolean {
    const { isManager, saleDate, todayStr } = params;
    // 점장 이상이면 항상 우회
    if (isManager) return true;
    // 과거 날짜이면 우회 (오늘 날짜는 시간 제한 적용)
    if (saleDate < todayStr) return true;
    return false;
  }

  it("점장은 오늘 날짜도 시간 제한을 우회한다", () => {
    expect(
      shouldBypassTimeRestriction({
        isManager: true,
        saleDate: "2026-03-19",
        todayStr: "2026-03-19",
      })
    ).toBe(true);
  });

  it("직원은 과거 날짜 입력 시 시간 제한을 우회한다", () => {
    expect(
      shouldBypassTimeRestriction({
        isManager: false,
        saleDate: "2026-03-18",
        todayStr: "2026-03-19",
      })
    ).toBe(true);
  });

  it("직원은 오늘 날짜 입력 시 시간 제한을 적용한다", () => {
    expect(
      shouldBypassTimeRestriction({
        isManager: false,
        saleDate: "2026-03-19",
        todayStr: "2026-03-19",
      })
    ).toBe(false);
  });

  it("직원은 미래 날짜 입력 시 시간 제한을 적용한다", () => {
    expect(
      shouldBypassTimeRestriction({
        isManager: false,
        saleDate: "2026-03-20",
        todayStr: "2026-03-19",
      })
    ).toBe(false);
  });
});
