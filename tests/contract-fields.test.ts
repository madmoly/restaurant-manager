/**
 * 전자계약서 필드 분류 및 상태 전이 테스트
 *
 * 테스트 대상:
 * - shared/contractFields.ts: A/B/C군 필드 분류 무결성
 * - 계약서 상태 전이 규칙 (draft→sent→signed→superseded)
 * - 스냅샷 필드 ↔ C군 필드 매핑 일관성
 * - 직원당 1계약 원칙
 *
 * DB 트랜잭션 로직(signContract)은 integration test 대상이므로
 * 여기서는 필드 분류와 상태 전이 규칙만 단위 테스트한다.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { A_FIELDS, B_FIELDS, C_FIELDS } from "../shared/contractFields.js";
import { employmentElectronicContracts } from "../drizzle/schema.js";

// ─── 필드 분류 무결성 ─────────────────────────────────────────────────────────

describe("계약서 필드 분류 (A/B/C군)", () => {
  it("A군(계약서 전용): 5개 필드", () => {
    expect(A_FIELDS).toEqual([
      "wage",
      "wageType",
      "weeklyHours",
      "contractStart",
      "contractEnd",
    ]);
  });

  it("B군(직원정보 전용): 5개 필드", () => {
    expect(B_FIELDS).toEqual([
      "healthCertUrl",
      "healthCertExpiry",
      "bankbookUrl",
      "username",
      "passwordHash",
    ]);
  });

  it("C군(스냅샷 박제 대상): 8개 필드", () => {
    expect(C_FIELDS).toEqual([
      "name",
      "phone",
      "address",
      "residentNumber",
      "bankAccount",
      "affiliatedCompany",
      "hireDate",
      "contractOffDays",
    ]);
  });

  it("A/B/C군 사이에 중복 필드 없음", () => {
    const all = [...A_FIELDS, ...B_FIELDS, ...C_FIELDS];
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  it("민감 정보 필드가 올바른 군에 배치됨", () => {
    // residentNumber, bankAccount는 C군 (서명 시 sync 대상)
    expect(C_FIELDS).toContain("residentNumber");
    expect(C_FIELDS).toContain("bankAccount");
    // passwordHash는 B군 (계약서와 무관)
    expect(B_FIELDS).toContain("passwordHash");
  });
});

// ─── 스냅샷 필드 매핑 ─────────────────────────────────────────────────────────

describe("스냅샷 필드 매핑", () => {
  // 하드코딩 픽스처 금지 — drizzle 스키마에서 실제 snapshot* 컬럼을 파생해 검증한다.
  const SNAPSHOT_FIELDS = Object.keys(
    getTableColumns(employmentElectronicContracts),
  ).filter((key) => key.startsWith("snapshot"));

  const toSnapshotName = (field: string) =>
    `snapshot${field.charAt(0).toUpperCase() + field.slice(1)}`;

  it("스키마에 snapshot* 컬럼이 존재함 (파생 실패 감지)", () => {
    expect(SNAPSHOT_FIELDS.length).toBeGreaterThanOrEqual(20);
  });

  it("A군 전부 스냅샷됨", () => {
    for (const field of A_FIELDS) {
      expect(SNAPSHOT_FIELDS).toContain(toSnapshotName(field));
    }
  });

  it("C군 전부 스냅샷됨 (residentNumber, bankAccount, hireDate 포함)", () => {
    for (const field of C_FIELDS) {
      expect(SNAPSHOT_FIELDS).toContain(toSnapshotName(field));
    }
  });

  it("B군 필드는 스냅샷되지 않음 (계약서와 무관)", () => {
    for (const field of B_FIELDS) {
      expect(SNAPSHOT_FIELDS).not.toContain(toSnapshotName(field));
    }
  });

  it("deprecated snapshotWeeklyOffDays는 snapshotContractOffDays와 공존", () => {
    // 2026-07-02 계약휴무일수 컬럼 교체 — 구 컬럼은 데이터 보존용으로 유지
    expect(SNAPSHOT_FIELDS).toContain("snapshotWeeklyOffDays");
    expect(SNAPSHOT_FIELDS).toContain("snapshotContractOffDays");
  });
});

// ─── 상태 전이 규칙 ───────────────────────────────────────────────────────────

describe("계약서 상태 전이", () => {
  type ContractStatus = "draft" | "sent" | "signed" | "expired" | "superseded";

  // 상태 전이 테이블 (현재 상태 → 허용된 다음 상태)
  const VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
    draft: ["sent"],      // 수정 후 발송
    sent: ["signed"],     // 서명 완료 (expired는 새 계약 작성 시 시스템이 처리)
    signed: ["superseded"], // 새 계약 서명 시 자동 전이
    expired: [],           // 삭제만 가능 (상태 전이 없음)
    superseded: [],        // 조회만 가능 (상태 전이 없음)
  };

  function isValidTransition(from: ContractStatus, to: ContractStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  it("draft → sent (발송)", () => {
    expect(isValidTransition("draft", "sent")).toBe(true);
  });

  it("sent → signed (서명)", () => {
    expect(isValidTransition("sent", "signed")).toBe(true);
  });

  it("signed → superseded (새 계약 서명)", () => {
    expect(isValidTransition("signed", "superseded")).toBe(true);
  });

  it("역방향 전이 불가", () => {
    expect(isValidTransition("sent", "draft")).toBe(false);
    expect(isValidTransition("signed", "sent")).toBe(false);
    expect(isValidTransition("superseded", "signed")).toBe(false);
  });

  it("최종 상태에서 전이 불가", () => {
    expect(isValidTransition("expired", "draft")).toBe(false);
    expect(isValidTransition("expired", "sent")).toBe(false);
    expect(isValidTransition("superseded", "draft")).toBe(false);
  });

  it("이미 signed된 계약에 재서명 불가", () => {
    expect(isValidTransition("signed", "signed")).toBe(false);
  });
});

// ─── 서명 토큰 검증 규칙 ──────────────────────────────────────────────────────

describe("서명 토큰", () => {
  it("토큰은 64자 hex (32바이트)", () => {
    // crypto.randomBytes(32).toString("hex") 기준
    const tokenPattern = /^[0-9a-f]{64}$/;
    // 예시 토큰
    const sampleToken = "a".repeat(64);
    expect(tokenPattern.test(sampleToken)).toBe(true);
  });

  it("짧은 토큰은 무효", () => {
    const tokenPattern = /^[0-9a-f]{64}$/;
    expect(tokenPattern.test("abc123")).toBe(false);
    expect(tokenPattern.test("")).toBe(false);
  });
});

// ─── 직원당 1계약 원칙 ────────────────────────────────────────────────────────

describe("직원당 1계약 원칙", () => {
  // supersede 로직 시뮬레이션
  function supersedePreviousContracts(
    contracts: { id: number; employeeId: number; restaurantId: number; status: string }[],
    newContractId: number,
    employeeId: number,
    restaurantId: number,
  ): { id: number; status: string }[] {
    return contracts.map((c) => {
      if (
        c.employeeId === employeeId &&
        c.restaurantId === restaurantId &&
        c.id !== newContractId &&
        ["draft", "sent", "signed"].includes(c.status)
      ) {
        return { ...c, status: "superseded" };
      }
      return c;
    });
  }

  it("새 계약 서명 시 같은 직원의 이전 계약 모두 superseded", () => {
    const contracts = [
      { id: 1, employeeId: 10, restaurantId: 1, status: "signed" },
      { id: 2, employeeId: 10, restaurantId: 1, status: "draft" },
      { id: 3, employeeId: 10, restaurantId: 1, status: "signed" }, // 새 계약
    ];

    const result = supersedePreviousContracts(contracts, 3, 10, 1);
    expect(result[0].status).toBe("superseded"); // id=1
    expect(result[1].status).toBe("superseded"); // id=2
    expect(result[2].status).toBe("signed");     // id=3 (새 계약 유지)
  });

  it("다른 직원의 계약은 영향 없음", () => {
    const contracts = [
      { id: 1, employeeId: 10, restaurantId: 1, status: "signed" },
      { id: 2, employeeId: 20, restaurantId: 1, status: "signed" }, // 다른 직원
      { id: 3, employeeId: 10, restaurantId: 1, status: "signed" }, // 새 계약
    ];

    const result = supersedePreviousContracts(contracts, 3, 10, 1);
    expect(result[1].status).toBe("signed"); // employeeId=20은 그대로
  });

  it("다른 매장의 같은 직원 계약은 영향 없음", () => {
    const contracts = [
      { id: 1, employeeId: 10, restaurantId: 1, status: "signed" },
      { id: 2, employeeId: 10, restaurantId: 2, status: "signed" }, // 다른 매장
      { id: 3, employeeId: 10, restaurantId: 1, status: "signed" },
    ];

    const result = supersedePreviousContracts(contracts, 3, 10, 1);
    expect(result[1].status).toBe("signed"); // restaurantId=2는 그대로
  });

  it("이미 expired/superseded된 계약은 재변경 안함", () => {
    const contracts = [
      { id: 1, employeeId: 10, restaurantId: 1, status: "expired" },
      { id: 2, employeeId: 10, restaurantId: 1, status: "superseded" },
      { id: 3, employeeId: 10, restaurantId: 1, status: "signed" },
    ];

    const result = supersedePreviousContracts(contracts, 3, 10, 1);
    expect(result[0].status).toBe("expired");     // 유지
    expect(result[1].status).toBe("superseded");   // 유지
    expect(result[2].status).toBe("signed");       // 새 계약
  });
});
