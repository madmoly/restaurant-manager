import { describe, it, expect } from "vitest";
import { toDateOnly } from "../shared/dateOnly";

describe("toDateOnly — DATE 컬럼 값 정규화", () => {
  it("이미 YYYY-MM-DD면 그대로", () => {
    expect(toDateOnly("2026-08-10")).toBe("2026-08-10");
  });

  it("tRPC JSON 직렬화 형태(ISO 문자열)를 자른다 — 운영일지 휴무일 오판정의 원인", () => {
    expect(toDateOnly("2026-08-10T00:00:00.000Z")).toBe("2026-08-10");
  });

  it("Drizzle 직접 조회 형태(JS Date)를 변환한다", () => {
    expect(toDateOnly(new Date("2026-08-10T00:00:00.000Z"))).toBe("2026-08-10");
  });

  it("null/undefined는 null", () => {
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly(undefined)).toBeNull();
  });

  it("세 형태가 모두 같은 값으로 수렴한다", () => {
    const forms = ["2026-08-10", "2026-08-10T00:00:00.000Z", new Date("2026-08-10T00:00:00.000Z")];
    const normalized = new Set(forms.map((f) => toDateOnly(f as any)));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe("2026-08-10");
  });
});
