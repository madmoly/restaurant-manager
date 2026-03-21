import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { getDb } from "../db";
import { employmentElectronicContracts, restaurants, type InsertEmploymentElectronicContract } from "../../drizzle/schema";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { notifyOwner } from "../_core/notification";
// ─── 역할 체크 헬퍼 ──────────────────────────────────────────────────────────
const ROLE_LEVEL: Record<string, number> = { master: 4, admin: 3, manager: 2, employee: 1, user: 1 };
function requireRole(userRole: string, minRole: string) {
  if ((ROLE_LEVEL[userRole] ?? 0) < (ROLE_LEVEL[minRole] ?? 99)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "권한이 부족합니다." });
  }
}

// ─── 2026년 최저임금 상수 ─────────────────────────────────────────────────────
export const MINIMUM_WAGE_2026 = 10320; // 시간당 원
export const MINIMUM_MONTHLY_WAGE_2026 = 2156880; // 주 40시간 기준 월급 (주휴 포함)

// ─── 날짜 정규화 헬퍼 (superjson이 Date 객체로 역직렬화할 수 있으므로) ──────────
function toDateStr(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    // Date 객체인 경우 로컬 날짜 기준 YYYY-MM-DD 추출
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // 문자열인 경우 T 앞부분만 추출
  return String(val).split("T")[0];
}

// ─── 계약서 HTML 생성 함수 ────────────────────────────────────────────────────
export function generateContractHtml(contract: typeof employmentElectronicContracts.$inferSelect, restaurantName: string): string {
  const contractTypeLabel: Record<string, string> = {
    permanent: "정규직 (무기계약)",
    fixed_term: "기간제 근로자",
    part_time: "단시간 근로자",
    daily: "일용직 근로자",
  };
  const wageTypeLabel = contract.wageType === "hourly" ? "시급" : "월급";
  const wageFormatted = Number(contract.wageAmount).toLocaleString("ko-KR");
  const minWageNote = contract.wageType === "hourly"
    ? `(2026년 최저시급 ${MINIMUM_WAGE_2026.toLocaleString()}원 이상)`
    : `(2026년 최저월급 ${MINIMUM_MONTHLY_WAGE_2026.toLocaleString()}원 이상)`;

  const probationText = contract.hasProbation && contract.probationMonths
    ? `수습기간 ${contract.probationMonths}개월 (수습 기간 중 최저임금의 90% 적용 가능)`
    : "수습기간 없음";

  const fmtDate = (d: Date | string | null | undefined) => {
    if (!d) return "";
    const dt = d instanceof Date ? d : new Date(String(d));
    return `${dt.getFullYear()}. ${dt.getMonth() + 1}. ${dt.getDate()}.`;
  };
  const contractPeriodText = contract.contractEnd
    ? `${fmtDate(contract.contractStart)} ~ ${fmtDate(contract.contractEnd)}`
    : `${fmtDate(contract.contractStart)} ~ 무기한 (정년까지)`;

  const insuranceText = contract.socialInsurance
    ? "국민연금, 건강보험, 고용보험, 산재보험 (4대보험 가입)"
    : "4대보험 미가입 (해당 없음)";

  const mealText = contract.mealProvided
    ? "식사 현물 제공"
    : Number(contract.mealAllowance) > 0
      ? `식대 월 ${Number(contract.mealAllowance).toLocaleString()}원 지급`
      : "식대 미제공";

  const nightText = contract.nightShiftConsent
    ? "야간근무(22:00~06:00) 동의함"
    : "야간근무 동의 없음";

  const over5Text = contract.over5Employees
    ? "5인 이상 사업장 — 연장·야간·휴일 가산수당(50%) 적용"
    : "5인 미만 사업장 — 가산수당 미적용";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>근로계약서 — ${contract.employeeName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 14px; color: #1a1a1a; background: #f8f9fa; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; }
    h1 { text-align: center; font-size: 22px; font-weight: 700; margin-bottom: 8px; letter-spacing: 4px; }
    .subtitle { text-align: center; font-size: 13px; color: #666; margin-bottom: 32px; }
    .notice { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px; font-size: 12px; color: #856404; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 15px; font-weight: 700; color: #1a1a1a; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    table td { padding: 8px 12px; border: 1px solid #ddd; vertical-align: top; }
    table td:first-child { background: #f5f5f5; font-weight: 600; width: 35%; white-space: nowrap; }
    .highlight { background: #e8f4fd !important; color: #0066cc; font-weight: 700; }
    .warning { background: #fff3cd !important; color: #856404; }
    .law-note { font-size: 11px; color: #888; margin-top: 4px; }
    .terms { background: #f9f9f9; border: 1px solid #ddd; border-radius: 4px; padding: 16px; font-size: 12px; line-height: 1.8; white-space: pre-wrap; }
    .signature-section { margin-top: 40px; border-top: 2px solid #333; padding-top: 24px; }
    .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 16px; }
    .signature-box { border: 1px solid #ddd; border-radius: 6px; padding: 16px; min-height: 120px; }
    .signature-box h3 { font-size: 13px; font-weight: 700; margin-bottom: 8px; color: #555; }
    .signature-field { border-bottom: 1px solid #999; min-height: 60px; margin-top: 8px; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 4px; }
    .signed-img { max-width: 200px; max-height: 80px; }
    .footer { text-align: center; font-size: 11px; color: #aaa; margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; }
    @media print { body { background: white; } .container { padding: 20px; } }
  </style>
</head>
<body>
<div class="container">
  <h1>근 로 계 약 서</h1>
  <p class="subtitle">근로기준법 제17조에 따른 표준 근로계약서</p>

  <div class="notice">
    ⚠️ 본 계약서는 근로기준법 제17조에 의거하여 작성되었습니다. 사용자는 근로계약 체결 시 근로조건을 명시하고 근로자에게 서면으로 교부할 의무가 있습니다.
  </div>

  <div class="section">
    <div class="section-title">제1조 계약 당사자</div>
    <table>
      <tr><td>사업장명 (갑)</td><td>${restaurantName}</td></tr>
      <tr><td>근로자 성명 (을)</td><td>${contract.employeeName}</td></tr>
      <tr><td>생년월일</td><td>${contract.employeeBirthdate || "—"}</td></tr>
      <tr><td>연락처</td><td>${contract.employeePhone || "—"}</td></tr>
      <tr><td>주소</td><td>${contract.employeeAddress || "—"}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">제2조 근로 계약 기간</div>
    <table>
      <tr><td>계약 유형</td><td>${contractTypeLabel[contract.contractType] || contract.contractType}</td></tr>
      <tr><td>계약 기간</td><td class="${contract.contractType === 'permanent' ? '' : 'highlight'}">${contractPeriodText}</td></tr>
      <tr><td>수습 기간</td><td>${probationText}</td></tr>
    </table>
    <p class="law-note">※ 기간제 근로자는 최대 2년까지 계약 가능하며, 2년 초과 시 무기계약으로 전환됩니다. (기간제법 제4조)</p>
  </div>

  <div class="section">
    <div class="section-title">제3조 근무 장소 및 업무</div>
    <table>
      <tr><td>근무 장소</td><td>${contract.workPlace || restaurantName}</td></tr>
      <tr><td>담당 업무</td><td>${contract.jobDescription || "사용자가 지시하는 업무 전반"}</td></tr>
      <tr><td>직책/포지션</td><td>${contract.position}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">제4조 소정 근로시간 및 휴게시간</div>
    <table>
      <tr><td>주 소정 근로시간</td><td class="highlight">주 ${contract.weeklyHours}시간</td></tr>
      <tr><td>근무 시각</td><td>${contract.workStartTime} ~ ${contract.workEndTime}</td></tr>
      <tr><td>휴게시간</td><td>${contract.breakMinutes}분 (근로시간 미포함)</td></tr>
      <tr><td>주휴일</td><td>${contract.weeklyHoliday} (유급)</td></tr>
    </table>
    <p class="law-note">※ 근로기준법 제54조: 4시간 근무 시 30분, 8시간 근무 시 1시간 이상 휴게시간 부여 의무</p>
    <p class="law-note">※ 근로기준법 제55조: 주 15시간 이상 근무 시 1일 유급 주휴일 부여 의무</p>
  </div>

  <div class="section">
    <div class="section-title">제5조 임금</div>
    <table>
      <tr><td>임금 형태</td><td>${wageTypeLabel}</td></tr>
      <tr><td class="">기본 ${wageTypeLabel}</td><td class="highlight">${wageFormatted}원 ${minWageNote}</td></tr>
      <tr><td>식대</td><td>${mealText}</td></tr>
      <tr><td>임금 지급일</td><td>매월 ${contract.payDay}일</td></tr>
      <tr><td>지급 방법</td><td>${contract.payMethod === "bank_transfer" ? "계좌이체" : "현금 지급"}</td></tr>
      <tr><td>4대보험</td><td>${insuranceText}</td></tr>
    </table>
    <p class="law-note">※ ${over5Text}</p>
    <p class="law-note">※ 최저임금법 제6조: 최저임금 미만 지급 시 3년 이하 징역 또는 2,000만원 이하 벌금</p>
  </div>

  <div class="section">
    <div class="section-title">제6조 연차유급휴가</div>
    <table>
      <tr><td>연차 적용</td><td>${contract.over5Employees ? "5인 이상 사업장 — 근로기준법 제60조 적용 (1년 15일, 최대 25일)" : "5인 미만 사업장 — 연차유급휴가 미적용"}</td></tr>
    </table>
    <p class="law-note">※ 1년 미만 근무 시 매월 개근 1일 유급휴가 발생 (5인 이상)</p>
  </div>

  <div class="section">
    <div class="section-title">제7조 야간·연장 근무</div>
    <table>
      <tr><td>야간 근무 동의</td><td>${nightText}</td></tr>
      <tr><td>가산수당</td><td>${contract.over5Employees ? "야간(22:00~06:00) · 연장 · 휴일 근로 시 통상임금의 50% 가산 지급" : "5인 미만 사업장으로 가산수당 미적용"}</td></tr>
    </table>
  </div>

  ${contract.specialTerms ? `
  <div class="section">
    <div class="section-title">제8조 특약사항</div>
    <div class="terms">${contract.specialTerms}</div>
  </div>` : ""}

  <div class="section">
    <div class="section-title">제${contract.specialTerms ? "9" : "8"}조 기타 사항</div>
    <div class="terms">1. 본 계약서에 명시되지 않은 사항은 근로기준법, 최저임금법 등 관련 법령에 따릅니다.
2. 사용자와 근로자는 각자 본 계약서 1부씩 보관합니다.
3. 근로계약 내용을 변경할 경우 반드시 서면으로 재작성하여 교부합니다.
4. 위생 및 복장 규정을 준수하며, 사업장 내 규칙을 따릅니다.
5. 개인정보(고객 정보, 레시피 등)는 재직 중 및 퇴직 후에도 외부에 유출하지 않습니다.</div>
  </div>

  <div class="signature-section">
    <p style="text-align:center; margin-bottom:16px; font-size:13px;">위와 같이 근로계약을 체결하고, 각자 서명·날인합니다.</p>
    <p style="text-align:center; margin-bottom:24px; font-size:13px; color:#666;">계약 체결일: ${new Date().toLocaleDateString("ko-KR")}</p>
    <div class="signature-grid">
      <div class="signature-box">
        <h3>사용자 (갑)</h3>
        <p style="font-size:12px; color:#666;">사업장명: ${restaurantName}</p>
        <div class="signature-field">
          <span style="font-size:12px; color:#aaa;">서명란</span>
        </div>
      </div>
      <div class="signature-box">
        <h3>근로자 (을)</h3>
        <p style="font-size:12px; color:#666;">성명: ${contract.employeeName}</p>
        <div class="signature-field">
          ${contract.employeeSignature
            ? `<img src="${contract.employeeSignature}" class="signed-img" alt="서명"/>`
            : `<span style="font-size:12px; color:#aaa;">서명란</span>`}
        </div>
        ${contract.signedAt ? `<p style="font-size:11px; color:#0066cc; margin-top:8px;">✓ 서명 완료: ${new Date(contract.signedAt).toLocaleString("ko-KR")}</p>` : ""}
      </div>
    </div>
  </div>

  <div class="footer">
    본 계약서는 전자적 방법으로 작성·교부되었습니다. | 근로기준법 제17조 준수
  </div>
</div>
</body>
</html>`;
}

// ─── 전자계약서 라우터 ────────────────────────────────────────────────────────
export const electronicContractsRouter = router({

  // 매장의 전자계약서 목록 조회 (점장/관리자)
  list: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ ctx, input }) => {
      const ROLE_LEVEL: Record<string, number> = { master: 4, admin: 3, manager: 2, employee: 1, user: 1 };
      if ((ROLE_LEVEL[ctx.user.role] ?? 0) < 2) {
        throw new TRPCError({ code: "FORBIDDEN", message: "점장 이상 권한이 필요합니다." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const contracts = await db.select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.restaurantId, input.restaurantId))
        .orderBy(desc(employmentElectronicContracts.createdAt));
      return contracts;
    }),

  // 특정 직원의 계약서 목록
  listByEmployee: protectedProcedure
    .input(z.object({ restaurantId: z.number(), employeeId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // 본인 또는 점장 이상만 조회 가능
      if (ctx.user.id !== input.employeeId && (ROLE_LEVEL[ctx.user.role] ?? 0) < 2) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return db.select()
        .from(employmentElectronicContracts)
        .where(and(
          eq(employmentElectronicContracts.restaurantId, input.restaurantId),
          eq(employmentElectronicContracts.employeeId, input.employeeId),
        ))
        .orderBy(desc(employmentElectronicContracts.createdAt));
    }),

  // 직원 이름 기반 계약 이력 조회 (점장/관리자)
  listByEmployeeName: protectedProcedure
    .input(z.object({ restaurantId: z.number(), employeeName: z.string() }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user.role, "manager");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { like } = await import("drizzle-orm");
      return db.select()
        .from(employmentElectronicContracts)
        .where(and(
          eq(employmentElectronicContracts.restaurantId, input.restaurantId),
          like(employmentElectronicContracts.employeeName, `%${input.employeeName}%`),
        ))
        .orderBy(desc(employmentElectronicContracts.createdAt));
    }),

  // 계약서 생성 (초안)
  create: protectedProcedure
    .input(z.object({
      restaurantId: z.number(),
      employeeId: z.number().optional(),
      employeeName: z.string().min(1),
      employeePhone: z.string().optional(),
      employeeBirthdate: z.string().optional(),
      employeeAddress: z.string().optional(),
      position: z.string().default("직원"),
      contractType: z.enum(["permanent", "fixed_term", "part_time", "daily"]),
      contractStart: z.union([z.string(), z.date()]),
      contractEnd: z.union([z.string(), z.date()]).optional(),
      hasProbation: z.boolean().default(false),
      probationMonths: z.number().default(0),
      workPlace: z.string().optional(),
      jobDescription: z.string().optional(),
      wageType: z.enum(["hourly", "monthly"]),
      wageAmount: z.number().min(0),
      weeklyHours: z.number().min(0).max(52).default(40),
      workStartTime: z.string().default("09:00"),
      workEndTime: z.string().default("18:00"),
      breakMinutes: z.number().default(60),
      weeklyHoliday: z.string().default("일요일"),
      payDay: z.number().min(1).max(31).default(25),
      payMethod: z.enum(["bank_transfer", "cash"]).default("bank_transfer"),
      mealProvided: z.boolean().default(false),
      mealAllowance: z.number().default(0),
      socialInsurance: z.boolean().default(true),
      over5Employees: z.boolean().default(false),
      nightShiftConsent: z.boolean().default(false),
      specialTerms: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.user.role, "manager");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 최저임금 검증
      const minWage = input.wageType === "hourly" ? MINIMUM_WAGE_2026 : MINIMUM_MONTHLY_WAGE_2026;
      if (input.wageAmount < minWage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `2026년 최저${input.wageType === "hourly" ? "시급" : "월급"}(${minWage.toLocaleString()}원)보다 낮습니다.`,
        });
      }

      const token = randomBytes(32).toString("hex");
      const newContract: InsertEmploymentElectronicContract = {
        token,
        restaurantId: input.restaurantId,
        employeeId: input.employeeId ?? null,
        employeeName: input.employeeName,
        employeePhone: input.employeePhone ?? null,
        employeeBirthdate: input.employeeBirthdate ?? null,
        employeeAddress: input.employeeAddress ?? null,
        position: input.position,
        contractType: input.contractType,
        contractStart: toDateStr(input.contractStart) as unknown as Date,
        contractEnd: toDateStr(input.contractEnd) as unknown as Date | null,
        hasProbation: input.hasProbation,
        probationMonths: input.probationMonths,
        workPlace: input.workPlace ?? null,
        jobDescription: input.jobDescription ?? null,
        wageType: input.wageType,
        wageAmount: String(input.wageAmount),
        weeklyHours: String(input.weeklyHours),
        workStartTime: input.workStartTime,
        workEndTime: input.workEndTime,
        breakMinutes: input.breakMinutes,
        weeklyHoliday: input.weeklyHoliday,
        payDay: input.payDay,
        payMethod: input.payMethod,
        mealProvided: input.mealProvided,
        mealAllowance: String(input.mealAllowance),
        socialInsurance: input.socialInsurance,
        over5Employees: input.over5Employees,
        nightShiftConsent: input.nightShiftConsent,
        specialTerms: input.specialTerms ?? null,
        status: "draft",
        createdBy: ctx.user.id,
      };
      await db.insert(employmentElectronicContracts).values(newContract);

      const [created] = await db.select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.token, token));
      return created;
    }),

  // 계약서 발송 (draft → sent)
  send: protectedProcedure
    .input(z.object({ contractId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.user.role, "manager");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [contract] = await db.select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.contractId));
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      if (contract.status !== "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "초안 상태의 계약서만 발송할 수 있습니다." });
      }

      await db.update(employmentElectronicContracts)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(employmentElectronicContracts.id, input.contractId));

      return { token: contract.token };
    }),

  // 계약서 취소
  cancel: protectedProcedure
    .input(z.object({ contractId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.user.role, "manager");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(employmentElectronicContracts)
        .set({ status: "cancelled" })
        .where(eq(employmentElectronicContracts.id, input.contractId));
      return { success: true };
    }),

  // 계약서 상세 조회 (토큰으로 — 직원 서명 페이지용, 공개)
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [row] = await db.select({
        contract: employmentElectronicContracts,
        restaurantName: restaurants.name,
      })
        .from(employmentElectronicContracts)
        .leftJoin(restaurants, eq(employmentElectronicContracts.restaurantId, restaurants.id))
        .where(eq(employmentElectronicContracts.token, input.token));
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "계약서를 찾을 수 없습니다." });
      return { ...row.contract, restaurantName: row.restaurantName ?? undefined };
    }),

  // 직원 서명 처리 (토큰 기반, 공개)
  sign: publicProcedure
    .input(z.object({
      token: z.string(),
      signatureData: z.string().min(1), // base64 이미지 또는 텍스트 서명
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [contract] = await db.select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.token, input.token));

      if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "계약서를 찾을 수 없습니다." });
      if (contract.status === "signed") throw new TRPCError({ code: "BAD_REQUEST", message: "이미 서명된 계약서입니다." });
      if (contract.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "취소된 계약서입니다." });
      if (contract.status !== "sent") throw new TRPCError({ code: "BAD_REQUEST", message: "발송되지 않은 계약서입니다." });

      // IP 주소 추출 (ctx에서)
      const ip = (ctx as any)?.req?.ip || (ctx as any)?.req?.headers?.["x-forwarded-for"] || "unknown";

      await db.update(employmentElectronicContracts)
        .set({
          status: "signed",
          signedAt: new Date(),
          employeeSignature: input.signatureData,
          signedIp: String(ip).substring(0, 45),
        })
        .where(eq(employmentElectronicContracts.token, input.token));

      // ─── 서명 완료 시 계약정보 자동 저장 (employeeContracts upsert) ──────────
      try {
        if (contract.employeeId) {
          const { employeeContracts } = await import("../../drizzle/schema");
          // 기존 활성 계약 비활성화
          await db.update(employeeContracts)
            .set({ isActive: false })
            .where(
              and(
                eq(employeeContracts.userId, contract.employeeId),
                eq(employeeContracts.restaurantId, contract.restaurantId),
                eq(employeeContracts.isActive, true)
              )
            );
          // 전자계약서 기반 신규 계약정보 생성
          await db.insert(employeeContracts).values({
            userId: contract.employeeId,
            restaurantId: contract.restaurantId,
            wageType: contract.wageType,
            wageAmount: String(contract.wageAmount),
            position: contract.position || "직원",
            contractStart: contract.contractStart ? new Date(contract.contractStart) : new Date(),
            contractEnd: contract.contractEnd ? new Date(contract.contractEnd) : null,
            contractNote: `전자계약서 #${contract.id} 서명 완료로 자동 생성`,
            weeklyHours: String(contract.weeklyHours),
            isActive: true,
          });
          console.log(`[ElectronicContract] 계약정보 자동 저장 완료: userId=${contract.employeeId}, contractId=${contract.id}`);
        }
      } catch (e) {
        // 계약정보 저장 실패는 서명 완료에 영향 없음
        console.error("[ElectronicContract] 계약정보 자동 저장 실패:", e);
      }

      // ─── 서명 완료 즉시 점장 알림 발송 ──────────────────────────────────────
      try {
        const signedAt = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
        const contractTypeLabel: Record<string, string> = {
          permanent: "정규직", fixed_term: "기간제", part_time: "단시간", daily: "일용직",
        };
        const typeLabel = contractTypeLabel[contract.contractType] || contract.contractType;
        await notifyOwner({
          title: `✅ 근로계약서 서명 완료 — ${contract.employeeName}`,
          content: [
            `직원 ${contract.employeeName}(${contract.employeePhone || "연락처 없음"})이 근로계약서에 서명했습니다.`,
            `계약 유형: ${typeLabel}`,
            `계약 기간: ${contract.contractStart}${contract.contractEnd ? ` ~ ${contract.contractEnd}` : " ~ 무기한"}`,
            `서명 일시: ${signedAt}`,
            `서명 IP: ${String(ip).substring(0, 45)}`,
          ].join("\n"),
        });
      } catch (e) {
        // 알림 실패는 서명 완료에 영향 없음
        console.error("[ElectronicContract] 서명 완료 알림 발송 실패:", e);
      }

      return { success: true };
    }),

  // 계약서 HTML 미리보기 (점장용)
  getHtml: protectedProcedure
    .input(z.object({ contractId: z.number(), restaurantName: z.string() }))
    .query(async ({ ctx, input }) => {
      requireRole(ctx.user.role, "manager");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [contract] = await db.select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.contractId));
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      return { html: generateContractHtml(contract, input.restaurantName) };
    }),

  // 계약서 HTML (토큰으로, 공개)
  getHtmlByToken: publicProcedure
    .input(z.object({ token: z.string(), restaurantName: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [contract] = await db.select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.token, input.token));
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      return { html: generateContractHtml(contract, input.restaurantName), contract };
    }),

  // 계약 갱신 — 기존 계약서 기반으로 새 계약서 생성 후 발송 대기
  renew: protectedProcedure
    .input(z.object({
      contractId: z.number(),
      newContractStart: z.union([z.string(), z.date()]),
      newContractEnd: z.union([z.string(), z.date()]).optional(),
      // 급여 변경이 있으면 입력, 없으면 기존 값 유지
      newWageAmount: z.number().optional(),
      newContractType: z.enum(["permanent", "fixed_term", "part_time", "daily"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx.user.role, "manager");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // 원본 계약서 조회
      const [original] = await db.select()
        .from(employmentElectronicContracts)
        .where(eq(employmentElectronicContracts.id, input.contractId));
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "원본 계약서를 찾을 수 없습니다." });

      // 수습(기간제 3개월 이하) → 1년 계약직 자동 전환 안내
      const originalDurationMonths = original.contractEnd
        ? Math.round((new Date(original.contractEnd).getTime() - new Date(original.contractStart).getTime()) / (1000 * 60 * 60 * 24 * 30))
        : 999;
      const isProbation = original.contractType === "fixed_term" && originalDurationMonths <= 3;
      const suggestedType = isProbation ? "fixed_term" : (input.newContractType || original.contractType);

      // 새 계약서 생성
      const newToken = randomBytes(32).toString("hex");
      const newContract: InsertEmploymentElectronicContract = {
        restaurantId: original.restaurantId,
        employeeId: original.employeeId,
        employeeName: original.employeeName,
        employeePhone: original.employeePhone,
        employeeBirthdate: original.employeeBirthdate,
        employeeAddress: original.employeeAddress,
        position: original.position,
        contractType: input.newContractType || suggestedType,
        contractStart: toDateStr(input.newContractStart) as unknown as Date,
        contractEnd: input.newContractEnd
          ? (toDateStr(input.newContractEnd) as unknown as Date)
          : isProbation
            // 수습 → 1년 계약직 기본 종료일 자동 계산
            ? (toDateStr(new Date(new Date(input.newContractStart).setFullYear(new Date(input.newContractStart).getFullYear() + 1))) as unknown as Date)
            : original.contractEnd ?? null,
        workPlace: original.workPlace,
        jobDescription: original.jobDescription,
        workStartTime: original.workStartTime,
        workEndTime: original.workEndTime,
        breakMinutes: original.breakMinutes,
        weeklyHours: original.weeklyHours,
        weeklyHoliday: original.weeklyHoliday,
        wageType: original.wageType,
        wageAmount: String(input.newWageAmount ?? original.wageAmount),
        payDay: original.payDay,
        payMethod: original.payMethod,
        hasProbation: false, // 갱신 계약에는 수습 없음
        probationMonths: 0,
        over5Employees: original.over5Employees,
        socialInsurance: original.socialInsurance,
        mealProvided: original.mealProvided,
        mealAllowance: original.mealAllowance,
        nightShiftConsent: original.nightShiftConsent,
        specialTerms: original.specialTerms,
        token: newToken,
        status: "draft",
        createdBy: ctx.user.id,
        previousContractId: original.id,
      };

      const [inserted] = await db.insert(employmentElectronicContracts)
        .values(newContract as any)
        .$returningId();

      return {
        success: true,
        newContractId: inserted.id,
        token: newToken,
        isProbationRenewal: isProbation,
        message: isProbation
          ? `수습 계약 종료 — 1년 기간제 계약서가 생성되었습니다. 발송 후 직원 서명을 받으세요.`
          : `계약 갱신 계약서가 생성되었습니다. 발송 후 직원 서명을 받으세요.`,
      };
    }),

  // 최저임금 정보 조회
  getMinimumWageInfo: publicProcedure.query(() => {
    return {
      year: 2026,
      hourlyWage: MINIMUM_WAGE_2026,
      monthlyWage: MINIMUM_MONTHLY_WAGE_2026,
      dailyWage: MINIMUM_WAGE_2026 * 8,
      note: "주 40시간 기준, 주휴수당 포함 월급",
      insuranceRates: {
        nationalPension: { employee: 4.5, employer: 4.5 },
        healthInsurance: { employee: 3.545, employer: 3.545 },
        longTermCare: { note: "건강보험료의 12.95%" },
        employmentInsurance: { employee: 0.9, employer: "0.9~1.65" },
        industrialAccident: { note: "업종별 상이, 근로자 부담 없음" },
      },
    };
  }),
});
