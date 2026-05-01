/**
 * staff 라우터 — 점장(owner) 중심 직원 생명주기
 *
 * 모든 mutation은 ownerProcedure + verifyStoreAccess(write) 조합으로 이중 보호.
 * 매니져(supervisor)는 listActive 등 읽기만 가능.
 *
 * 주요 흐름:
 *  - quickAdd: 신규/재입사/겸직 3분기 원클릭 등록 + 초대코드 선택 발급
 *  - resign/reinstate: 소프트 퇴사/복귀 (users row는 유지 — 타 매장 겸직 대비)
 *  - resetPassword: 임시 비밀번호 재발급 + mustChangePassword
 *  - changeRole: supervisor ↔ staff 상호 전환 (owner 임명은 별도)
 *  - listActive: 현직 직원 + 계약서 mismatchedFields 계산 동봉
 *  - listRecentlyResigned: 최근 90일 내 퇴사자 (재입사 원클릭 UI)
 */

import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { router, managerProcedure, ownerProcedure } from "../trpc";
import { db } from "../db";
import {
  users,
  restaurantUsers,
  employeeContracts,
  employmentElectronicContracts,
  auditLogs,
  restaurantInvites,
  affiliatedCompanies,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { verifyStoreAccess } from "../middleware/storeAuth";
import { hashPassword } from "../auth";

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/[^0-9]/g, "");
}

/** 임시 비밀번호 6자리 (숫자) */
function generateTempPassword(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** 사용자명 자동 생성 (전화번호 뒤 8자리 기반) */
function generateUsername(phoneNormalized: string): string {
  const base = phoneNormalized.slice(-8) || String(Date.now()).slice(-8);
  // 충돌 시 뒤에 난수 2자리
  return `u${base}`;
}

/** 6자리 초대코드 */
function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("base64url").slice(0, 6).toUpperCase();
}

/** 계약서와 직원정보 C군 필드 비교 — 불일치 필드명 반환 */
function computeMismatchedFields(
  current: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    residentNumber?: string | null;
    bankAccount?: string | null;
    affiliatedCompany?: string | null;
    hireDate?: string | Date | null;
    weeklyOffDays?: number | null;
    weeklyHours?: string | number | null;
    wageType?: string | null;
    wageAmount?: string | number | null;
  },
  snapshot: {
    snapshotName?: string | null;
    snapshotPhone?: string | null;
    snapshotAddress?: string | null;
    snapshotResidentNumber?: string | null;
    snapshotBankAccount?: string | null;
    snapshotAffiliatedCompany?: string | null;
    snapshotWeeklyOffDays?: number | null;
    snapshotWeeklyHours?: string | number | null;
    snapshotWageType?: string | null;
    snapshotWage?: string | number | null;
    snapshotHireDate?: string | Date | null;
    snapshotOver5Employees?: boolean | null;
  } | null,
  effectiveOver5?: boolean | null,
): string[] {
  if (!snapshot) return [];
  const diff: string[] = [];
  const numEq = (a: any, b: any): boolean => {
    if ((a == null || a === "") && (b == null || b === "")) return true;
    return Number(a) === Number(b);
  };
  const dateEq = (a: any, b: any): boolean => {
    const toIso = (x: any) => {
      if (x == null || x === "") return "";
      const d = x instanceof Date ? x : new Date(x);
      return Number.isNaN(d.getTime()) ? "" : d.toISOString().substring(0, 10);
    };
    return toIso(a) === toIso(b);
  };
  // 임금: wageType + wageAmount 결합 비교 (한 쪽이라도 다르면 wage 라벨)
  const wageMismatch =
    (current.wageType ?? "") !== (snapshot.snapshotWageType ?? "") ||
    !numEq(current.wageAmount, snapshot.snapshotWage);
  if (current.wageType || snapshot.snapshotWageType || current.wageAmount || snapshot.snapshotWage) {
    if (wageMismatch) diff.push("wage");
  }
  const pairs: Array<[string, any, any]> = [
    ["name", current.name, snapshot.snapshotName],
    ["phone", normalizePhone(current.phone), normalizePhone(snapshot.snapshotPhone)],
    ["address", (current.address ?? "").trim(), (snapshot.snapshotAddress ?? "").trim()],
    ["residentNumber", current.residentNumber, snapshot.snapshotResidentNumber],
    ["bankAccount", current.bankAccount, snapshot.snapshotBankAccount],
    ["affiliatedCompany", current.affiliatedCompany ?? "", snapshot.snapshotAffiliatedCompany ?? ""],
    ["weeklyOffDays", current.weeklyOffDays ?? null, snapshot.snapshotWeeklyOffDays ?? null],
  ];
  for (const [field, a, b] of pairs) {
    const isEmptyA = a === null || a === undefined || a === "";
    const isEmptyB = b === null || b === undefined || b === "";
    if (isEmptyA && isEmptyB) continue;
    if (String(a ?? "") !== String(b ?? "")) diff.push(field);
  }
  // 주근로시간 (decimal): 숫자 비교
  if (current.weeklyHours != null || snapshot.snapshotWeeklyHours != null) {
    if (!numEq(current.weeklyHours, snapshot.snapshotWeeklyHours)) diff.push("weeklyHours");
  }
  // 입사일: SSOT(restaurant_users.hireDate) ↔ snapshotHireDate
  if (current.hireDate != null || snapshot.snapshotHireDate != null) {
    if (!dateEq(current.hireDate, snapshot.snapshotHireDate)) diff.push("hireDate");
  }
  // 5인 여부: 소속회사 마스터 effectiveOver5 ↔ snapshotOver5Employees
  if (effectiveOver5 != null && snapshot.snapshotOver5Employees != null) {
    if (Boolean(effectiveOver5) !== Boolean(snapshot.snapshotOver5Employees)) diff.push("over5Employees");
  }
  return diff;
}

export const staffRouter = router({
  // ═══════════════════════════════════════════════════════════════════════
  // 읽기: listActive / listRecentlyResigned / checkPhone
  // ═══════════════════════════════════════════════════════════════════════

  /** 현직 직원 목록 (읽기는 매니져 가능) + 계약서 mismatchedFields 동봉 */
  listActive: managerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId);

      const rows = await db
        .select({
          userId: users.id,
          username: users.username,
          name: users.name,
          phone: users.phone,
          email: users.email,
          address: users.address,
          healthCertUrl: users.healthCertUrl,
          healthCertExpiry: users.healthCertExpiry,
          bankBookUrl: users.bankBookUrl,
          mustChangePassword: users.mustChangePassword,
          // restaurant_users
          storeRole: restaurantUsers.role,
          affiliatedCompany: restaurantUsers.affiliatedCompany,
          hireDate: restaurantUsers.hireDate,
          // 재설계 2026-05-02 (Phase B): weeklyOffDays SSOT는 restaurant_users
          weeklyOffDays: restaurantUsers.weeklyOffDays,
          rehiredAt: restaurantUsers.rehiredAt,
          // 활성 employeeContracts (민감영역 현재상태)
          wageType: employeeContracts.wageType,
          wageAmount: employeeContracts.wageAmount,
          position: employeeContracts.position,
          contractStart: employeeContracts.contractStart,
          contractEnd: employeeContracts.contractEnd,
          weeklyHours: employeeContracts.weeklyHours,
          bankName: employeeContracts.bankName,
          bankAccount: employeeContracts.bankAccount,
          residentNumber: employeeContracts.residentNumber,
        })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .leftJoin(
          employeeContracts,
          and(
            eq(employeeContracts.userId, restaurantUsers.userId),
            eq(employeeContracts.restaurantId, restaurantUsers.restaurantId),
            eq(employeeContracts.isActive, true),
          ),
        )
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          isNull(restaurantUsers.resignedAt),
          eq(users.isActive, true),
        ));

      // 각 직원별로 최신 signed 계약서 스냅샷 조회 → mismatchedFields 계산
      const userIds = rows.map((r) => r.userId);
      const snapshotsMap = new Map<number, any>();
      if (userIds.length > 0) {
        const snaps = await db
          .select({
            employeeId: employmentElectronicContracts.employeeId,
            signedAt: employmentElectronicContracts.signedAt,
            snapshotName: employmentElectronicContracts.snapshotName,
            snapshotPhone: employmentElectronicContracts.snapshotPhone,
            snapshotAddress: employmentElectronicContracts.snapshotAddress,
            snapshotResidentNumber: employmentElectronicContracts.snapshotResidentNumber,
            snapshotBankAccount: employmentElectronicContracts.snapshotBankAccount,
            snapshotAffiliatedCompany: employmentElectronicContracts.snapshotAffiliatedCompany,
            snapshotWeeklyOffDays: employmentElectronicContracts.snapshotWeeklyOffDays,
            snapshotWeeklyHours: employmentElectronicContracts.snapshotWeeklyHours,
            snapshotWageType: employmentElectronicContracts.snapshotWageType,
            snapshotWage: employmentElectronicContracts.snapshotWage,
            // 재설계 2026-05-02 신규 박제
            snapshotHireDate: employmentElectronicContracts.snapshotHireDate,
            snapshotOver5Employees: employmentElectronicContracts.snapshotOver5Employees,
            snapshotTaxMode: employmentElectronicContracts.snapshotTaxMode,
          })
          .from(employmentElectronicContracts)
          .where(and(
            eq(employmentElectronicContracts.restaurantId, input.restaurantId),
            eq(employmentElectronicContracts.status, "signed"),
          ))
          .orderBy(desc(employmentElectronicContracts.signedAt));
        // 각 employeeId의 가장 최근 것만
        for (const s of snaps) {
          if (s.employeeId && !snapshotsMap.has(s.employeeId)) {
            snapshotsMap.set(s.employeeId, s);
          }
        }
      }

      // 매장의 affiliated_companies 마스터 미리 조회 → 직원별 effectiveOver5 매핑
      const ac = await db
        .select({
          companyName: affiliatedCompanies.companyName,
          over5Employees: affiliatedCompanies.over5Employees,
        })
        .from(affiliatedCompanies)
        .where(eq(affiliatedCompanies.restaurantId, input.restaurantId));
      const over5Map = new Map<string, boolean>();
      for (const c of ac) over5Map.set(c.companyName, Boolean(c.over5Employees));

      // 매니져(supervisor) 호출 시 급여 필드 drop — 민감정보 방어
      const isOwnerLevel =
        ctx.user.role === "master" ||
        ctx.user.role === "admin" ||
        (() => {
          // user 레벨은 managerProcedure에서 허용됐으므로 supervisor일 수 있음
          // listActive는 supervisor도 호출 가능 → 서버측에서 필드 drop
          return false;
        })();

      // user 레벨인 경우 store role 확인
      let viewerStoreRole: string | null = null;
      if (!isOwnerLevel) {
        const [ru] = await db
          .select({ role: restaurantUsers.role })
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.userId, ctx.user.userId),
            eq(restaurantUsers.restaurantId, input.restaurantId),
            isNull(restaurantUsers.resignedAt),
          ))
          .limit(1);
        viewerStoreRole = ru?.role ?? null;
      }
      const canSeeWage =
        isOwnerLevel ||
        viewerStoreRole === "owner" ||
        viewerStoreRole === "store_manager";

      return rows.map((r) => {
        const snap = snapshotsMap.get(r.userId) ?? null;
        const effectiveOver5 = r.affiliatedCompany ? over5Map.get(r.affiliatedCompany) ?? false : false;
        const mismatchedFields = computeMismatchedFields(
          {
            name: r.name,
            phone: r.phone,
            address: r.address,
            residentNumber: r.residentNumber,
            bankAccount: r.bankAccount,
            affiliatedCompany: r.affiliatedCompany,
            hireDate: r.hireDate,
            weeklyOffDays: r.weeklyOffDays,
            weeklyHours: r.weeklyHours,
            wageType: r.wageType,
            wageAmount: r.wageAmount,
          },
          snap,
          effectiveOver5,
        );
        const out: any = {
          ...r,
          effectiveOver5,
          mismatchedFields,
          hasActiveContract: !!snap,
          latestContractSignedAt: snap?.signedAt ?? null,
          // 박제값 직접 노출 — 클라이언트 갱신 배너 / 분기 표시용
          snapshotHireDate: snap?.snapshotHireDate ?? null,
          snapshotOver5Employees: snap?.snapshotOver5Employees ?? null,
          snapshotTaxMode: snap?.snapshotTaxMode ?? null,
          snapshotAffiliatedCompany: snap?.snapshotAffiliatedCompany ?? null,
          snapshotWeeklyOffDays: snap?.snapshotWeeklyOffDays ?? null,
        };
        if (!canSeeWage) {
          delete out.wageType;
          delete out.wageAmount;
          delete out.weeklyHours;
          delete out.position;
          delete out.contractStart;
          delete out.contractEnd;
        }
        return out;
      });
    }),

  /** 최근 90일 내 퇴사자 — 재입사 원클릭용 */
  listRecentlyResigned: ownerProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const since = new Date();
      since.setDate(since.getDate() - 90);
      const sinceStr = since.toISOString().slice(0, 10);

      return db
        .select({
          userId: users.id,
          name: users.name,
          phone: users.phone,
          storeRole: restaurantUsers.role,
          resignedAt: restaurantUsers.resignedAt,
          resignReason: restaurantUsers.resignReason,
          hireDate: restaurantUsers.hireDate,
        })
        .from(restaurantUsers)
        .innerJoin(users, eq(users.id, restaurantUsers.userId))
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          sql`${restaurantUsers.resignedAt} IS NOT NULL`,
          sql`${restaurantUsers.resignedAt} >= ${sinceStr}`,
        ))
        .orderBy(desc(restaurantUsers.resignedAt));
    }),

  /** 전화번호 중복/재입사/겸직 사전 체크 (모달 실시간 조회용) */
  checkPhone: ownerProcedure
    .input(z.object({ restaurantId: z.number(), phone: z.string() }))
    .query(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);
      const phoneN = normalizePhone(input.phone);
      if (!phoneN) return { status: "empty" as const };

      const [existingUser] = await db
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.phoneNormalized, phoneN))
        .limit(1);

      if (!existingUser) {
        return { status: "new" as const };
      }

      // 해당 user의 현재 매장 배정 확인
      const [currentAssign] = await db
        .select({
          role: restaurantUsers.role,
          resignedAt: restaurantUsers.resignedAt,
        })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.userId, existingUser.id),
          eq(restaurantUsers.restaurantId, input.restaurantId),
        ))
        .limit(1);

      if (currentAssign && !currentAssign.resignedAt) {
        return {
          status: "duplicate" as const,
          userId: existingUser.id,
          name: existingUser.name,
        };
      }
      if (currentAssign && currentAssign.resignedAt) {
        return {
          status: "rehire" as const,
          userId: existingUser.id,
          name: existingUser.name,
          resignedAt: currentAssign.resignedAt,
        };
      }

      // 다른 매장 근무중 여부
      const others = await db
        .select({ restaurantId: restaurantUsers.restaurantId })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.userId, existingUser.id),
          isNull(restaurantUsers.resignedAt),
        ));
      if (others.length > 0) {
        return {
          status: "concurrent" as const,
          userId: existingUser.id,
          name: existingUser.name,
          otherStoreCount: others.length,
        };
      }

      // 유저는 있지만 매장 배정 없음 → 그냥 재사용
      return {
        status: "existing" as const,
        userId: existingUser.id,
        name: existingUser.name,
      };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // 쓰기: quickAdd / resign / reinstate / resetPassword / changeRole
  // ═══════════════════════════════════════════════════════════════════════

  /** 원스텝 직원 추가 — 신규/재입사/겸직 자동 분기 */
  quickAdd: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      name: z.string().min(1),
      phone: z.string().min(1),
      role: z.enum(["supervisor", "staff"]).default("staff"),
      sendInvite: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const phoneN = normalizePhone(input.phone);
      if (!phoneN) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "유효한 전화번호가 필요합니다" });
      }

      // 1. 동일 전화번호 사용자 조회
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.phoneNormalized, phoneN))
        .limit(1);

      let userId: number;
      let status: "new" | "rehire" | "concurrent" | "existing" = "new";
      let tempPassword: string | null = null;

      if (!existingUser) {
        // ── 신규 user 생성 ──
        tempPassword = generateTempPassword();
        const hash = await hashPassword(tempPassword);
        let username = generateUsername(phoneN);
        // username 충돌 처리 (최대 5회 재시도)
        for (let i = 0; i < 5; i++) {
          const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
          if (!dup) break;
          username = `${generateUsername(phoneN)}${Math.floor(Math.random() * 90 + 10)}`;
        }
        const [created] = await db.insert(users).values({
          username,
          passwordHash: hash,
          name: input.name,
          phone: input.phone,
          phoneNormalized: phoneN,
          role: "user",
          mustChangePassword: true,
        }).$returningId();
        userId = created.id;
      } else {
        userId = existingUser.id;
        // 이미 본 매장 배정 있는지
        const [currentAssign] = await db
          .select()
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.userId, userId),
            eq(restaurantUsers.restaurantId, input.restaurantId),
          ))
          .limit(1);

        if (currentAssign && !currentAssign.resignedAt) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "이미 이 매장에 등록된 직원입니다",
          });
        }

        if (currentAssign && currentAssign.resignedAt) {
          // ── 재입사 ──
          await db.update(restaurantUsers)
            .set({
              resignedAt: null,
              resignReason: null,
              role: input.role,
              rehiredAt: new Date(),
            })
            .where(eq(restaurantUsers.id, currentAssign.id));
          // audit
          await db.insert(auditLogs).values({
            userId: ctx.user.userId,
            userName: ctx.user.name || ctx.user.username,
            restaurantId: input.restaurantId,
            action: "update",
            target: "staff",
            targetId: userId,
            details: { kind: "rehire", role: input.role },
          });
          status = "rehire";
          return {
            userId,
            status,
            restaurantUserId: currentAssign.id,
            tempPassword: null,
            inviteCode: null,
          };
        }

        // 다른 매장 근무 중인지
        const others = await db
          .select({ id: restaurantUsers.id })
          .from(restaurantUsers)
          .where(and(
            eq(restaurantUsers.userId, userId),
            isNull(restaurantUsers.resignedAt),
          ));
        status = others.length > 0 ? "concurrent" : "existing";

        // phoneNormalized/name 보정 (없었으면 채움)
        const updates: any = {};
        if (!existingUser.phoneNormalized) updates.phoneNormalized = phoneN;
        if (existingUser.name !== input.name && !existingUser.name) updates.name = input.name;
        if (Object.keys(updates).length > 0) {
          await db.update(users).set(updates).where(eq(users.id, userId));
        }
      }

      // 2. restaurant_users 배정
      // Phase 2: 신규 직원은 contractMigrated=false 명시. 전자계약서 서명 시 true로 전환.
      const [created] = await db.insert(restaurantUsers).values({
        restaurantId: input.restaurantId,
        userId,
        role: input.role,
        contractMigrated: false,
      } as any).$returningId();

      // audit
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "create",
        target: "staff",
        targetId: userId,
        details: { kind: status, role: input.role },
      });

      // 3. 초대코드 발급 (옵션)
      let inviteCode: string | null = null;
      if (input.sendInvite) {
        const code = generateInviteCode();
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
        await db.insert(restaurantInvites).values({
          restaurantId: input.restaurantId,
          code,
          role: input.role,
          createdBy: ctx.user.userId,
          expiresAt,
        });
        inviteCode = code;
      }

      return {
        userId,
        status,
        restaurantUserId: created.id,
        tempPassword,
        inviteCode,
      };
    }),

  /** 퇴사 처리 (소프트) */
  resign: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      resignedAt: z.string().optional(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const resignDate = input.resignedAt ?? new Date().toISOString().slice(0, 10);

      const [target] = await db
        .select({ id: restaurantUsers.id, resignedAt: restaurantUsers.resignedAt })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 직원을 찾을 수 없습니다" });
      }
      if (target.resignedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "이미 퇴사 처리된 직원입니다" });
      }

      await db.update(restaurantUsers)
        .set({ resignedAt: resignDate, resignReason: input.reason ?? null })
        .where(eq(restaurantUsers.id, target.id));

      // 퇴사일 이후 draft 스케줄 자동 취소
      await db.execute(sql`
        UPDATE schedules
        SET status = 'canceled'
        WHERE restaurantId = ${input.restaurantId}
          AND userId = ${input.userId}
          AND status = 'draft'
          AND DATE(startTime) > ${resignDate}
      `);

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "delete",
        target: "staff",
        targetId: input.userId,
        details: { kind: "resign", resignedAt: resignDate, reason: input.reason ?? null },
      });

      return { ok: true };
    }),

  /** 퇴사 취소 (명시적 복원 — 일반적으로는 quickAdd rehire 분기 사용 권장) */
  reinstate: ownerProcedure
    .input(z.object({ restaurantId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      await db.update(restaurantUsers)
        .set({ resignedAt: null, resignReason: null, rehiredAt: new Date() })
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ));

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff",
        targetId: input.userId,
        details: { kind: "reinstate" },
      });

      return { ok: true };
    }),

  /** 임시 비밀번호 재발급 */
  resetPassword: ownerProcedure
    .input(z.object({ restaurantId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      // 해당 직원이 본 매장 소속인지
      const [ru] = await db
        .select({ id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!ru) {
        throw new TRPCError({ code: "NOT_FOUND", message: "이 매장의 직원이 아닙니다" });
      }

      const tempPassword = generateTempPassword();
      const hash = await hashPassword(tempPassword);
      await db.update(users)
        .set({ passwordHash: hash, mustChangePassword: true })
        .where(eq(users.id, input.userId));

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff",
        targetId: input.userId,
        details: { kind: "reset_password" },
      });

      return { ok: true, tempPassword };
    }),

  /** 매장 역할 전환 (supervisor ↔ staff) */
  changeRole: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      newRole: z.enum(["supervisor", "staff"]),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [target] = await db
        .select({ role: restaurantUsers.role, id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "해당 직원을 찾을 수 없습니다" });
      }
      if (target.role === "owner" || target.role === "store_manager") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "점장의 역할 변경은 별도 플로우를 사용하세요",
        });
      }

      await db.update(restaurantUsers)
        .set({
          role: input.newRole,
          roleChangedAt: new Date(),
          roleChangedBy: ctx.user.userId,
        })
        .where(eq(restaurantUsers.id, target.id));

      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff_role",
        targetId: input.userId,
        details: { before: { role: target.role }, after: { role: input.newRole } },
      });

      return { ok: true };
    }),

  /** C군/B군 직원정보 수동 편집 — 감사 로그 남김 (불일치 허용) */
  updateInfo: ownerProcedure
    .input(z.object({
      restaurantId: z.number(),
      userId: z.number(),
      name: z.string().min(1).optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      bankName: z.string().optional(),
      bankAccount: z.string().optional(),
      residentNumber: z.string().optional(),
      affiliatedCompany: z.string().nullable().optional(),
      hireDate: z.string().nullable().optional(),
      weeklyOffDays: z.number().int().min(1).max(3).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await verifyStoreAccess(ctx.user.userId, ctx.user.role, input.restaurantId, true);

      const [ru] = await db
        .select({ id: restaurantUsers.id })
        .from(restaurantUsers)
        .where(and(
          eq(restaurantUsers.restaurantId, input.restaurantId),
          eq(restaurantUsers.userId, input.userId),
        ))
        .limit(1);
      if (!ru) {
        throw new TRPCError({ code: "NOT_FOUND", message: "이 매장의 직원이 아닙니다" });
      }

      // users 업데이트
      const usersUpdate: Record<string, any> = {};
      if (input.name !== undefined) usersUpdate.name = input.name;
      if (input.phone !== undefined) {
        usersUpdate.phone = input.phone;
        usersUpdate.phoneNormalized = normalizePhone(input.phone);
      }
      if (input.address !== undefined) usersUpdate.address = input.address;
      if (input.email !== undefined) usersUpdate.email = input.email || null;
      if (Object.keys(usersUpdate).length > 0) {
        await db.update(users).set(usersUpdate).where(eq(users.id, input.userId));
      }

      // restaurant_users 업데이트 (재설계 2026-05-02: weeklyOffDays SSOT 포함)
      const ruUpdate: Record<string, any> = {};
      if (input.affiliatedCompany !== undefined) ruUpdate.affiliatedCompany = input.affiliatedCompany;
      if (input.hireDate !== undefined) ruUpdate.hireDate = input.hireDate;
      if (input.weeklyOffDays !== undefined) ruUpdate.weeklyOffDays = input.weeklyOffDays;
      if (Object.keys(ruUpdate).length > 0) {
        await db.update(restaurantUsers).set(ruUpdate).where(eq(restaurantUsers.id, ru.id));
      }

      // employee_contracts (민감영역 현재상태) 업데이트
      if (
        input.bankName !== undefined ||
        input.bankAccount !== undefined ||
        input.residentNumber !== undefined
      ) {
        const [ec] = await db
          .select({ id: employeeContracts.id })
          .from(employeeContracts)
          .where(and(
            eq(employeeContracts.userId, input.userId),
            eq(employeeContracts.restaurantId, input.restaurantId),
            eq(employeeContracts.isActive, true),
          ))
          .limit(1);
        const ecUpdate: Record<string, any> = {};
        if (input.bankName !== undefined) ecUpdate.bankName = input.bankName;
        if (input.bankAccount !== undefined) ecUpdate.bankAccount = input.bankAccount;
        if (input.residentNumber !== undefined) ecUpdate.residentNumber = input.residentNumber;
        if (ec) {
          await db.update(employeeContracts).set(ecUpdate).where(eq(employeeContracts.id, ec.id));
        } else {
          await db.insert(employeeContracts).values({
            userId: input.userId,
            restaurantId: input.restaurantId,
            bankName: ecUpdate.bankName ?? null,
            bankAccount: ecUpdate.bankAccount ?? null,
            residentNumber: ecUpdate.residentNumber ?? null,
            isActive: true,
          } as any);
        }
      }

      // audit — 수동 C군 편집 표시
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name || ctx.user.username,
        restaurantId: input.restaurantId,
        action: "update",
        target: "staff_info",
        targetId: input.userId,
        details: { kind: "manual_c_edit", fields: Object.keys(input).filter((k) => !["restaurantId", "userId"].includes(k)) },
      });

      return { ok: true };
    }),
});
