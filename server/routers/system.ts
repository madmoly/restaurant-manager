import { z } from "zod";
import { eq, and, between, sql, desc, gte, lte, isNull } from "drizzle-orm";
import { router, masterProcedure, adminProcedure } from "../trpc";
import { db } from "../db";
import {
  auditLogs, systemSettings, apiUsageLogs, dbBackupLogs,
  notifications, users, restaurants, sales, dailyClosings, schedules,
  fixedCosts, restaurantUsers, employmentElectronicContracts, affiliatedCompanies,
} from "../../drizzle/schema";

export const systemRouter = router({
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 감사 로그
  // ═══════════════════════════════════════════════════════════════════════════

  /** 감사 로그 조회 (페이지네이션) */
  auditList: masterProcedure
    .input(z.object({
      limit: z.number().default(30),
      offset: z.number().default(0),
      target: z.string().optional(),
      userId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const conditions: any[] = [];
      if (input.target) conditions.push(eq(auditLogs.target, input.target));
      if (input.userId) conditions.push(eq(auditLogs.userId, input.userId));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db.select().from(auditLogs)
        .where(where).orderBy(desc(auditLogs.createdAt))
        .limit(input.limit).offset(input.offset);

      const [countRow] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(auditLogs).where(where);

      return { rows, total: countRow?.count ?? 0 };
    }),

  /** 감사 로그 요약 (최근 7일 기준) */
  auditSummary: masterProcedure.query(async () => {
    const since = new Date(Date.now() - 7 * 86400000);
    const [row] = await db.select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs).where(gte(auditLogs.createdAt, since));

    const byAction = await db.select({
      action: auditLogs.action,
      count: sql<number>`COUNT(*)`,
    }).from(auditLogs).where(gte(auditLogs.createdAt, since))
      .groupBy(auditLogs.action);

    const byTarget = await db.select({
      target: auditLogs.target,
      count: sql<number>`COUNT(*)`,
    }).from(auditLogs).where(gte(auditLogs.createdAt, since))
      .groupBy(auditLogs.target).orderBy(desc(sql`COUNT(*)`)).limit(10);

    return { total7d: row?.count ?? 0, byAction, byTarget };
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 공지사항 발송
  // ═══════════════════════════════════════════════════════════════════════════

  /** 전체 또는 매장별 공지 발송 */
  sendAnnouncement: masterProcedure
    .input(z.object({
      title: z.string().min(1),
      content: z.string().optional(),
      restaurantId: z.number().optional(), // null = 전체
    }))
    .mutation(async ({ ctx, input }) => {
      // 대상 사용자 결정
      let targetUsers: { id: number }[];
      if (input.restaurantId) {
        const rows = await db.select({ id: restaurantUsers.userId })
          .from(restaurantUsers)
          .where(eq(restaurantUsers.restaurantId, input.restaurantId));
        targetUsers = rows;
      } else {
        const rows = await db.select({ id: users.id }).from(users)
          .where(eq(users.isActive, true));
        targetUsers = rows;
      }

      let sent = 0;
      for (const u of targetUsers) {
        await db.insert(notifications).values({
          recipientId: u.id,
          type: "system_announcement",
          title: input.title,
          content: input.content,
          restaurantId: input.restaurantId,
        });
        sent++;
      }

      // 감사 로그
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name ?? "master",
        action: "create",
        target: "announcement",
        details: { title: input.title, restaurantId: input.restaurantId, recipientCount: sent },
      });

      return { ok: true, sent };
    }),

  /** 최근 발송 공지 목록 */
  recentAnnouncements: masterProcedure.query(async () => {
    const rows = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.target, "announcement"), eq(auditLogs.action, "create")))
      .orderBy(desc(auditLogs.createdAt)).limit(20);
    return rows;
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 세션/접속 관리
  // ═══════════════════════════════════════════════════════════════════════════

  /** 최근 활동 사용자 (lastSignedIn 기준) */
  activeSessions: masterProcedure.query(async () => {
    const rows = await db.select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      lastSignedIn: users.lastSignedIn,
      isActive: users.isActive,
    }).from(users)
      .orderBy(desc(users.lastSignedIn)).limit(30);
    return rows;
  }),

  /** 사용자 비활성화 (강제 로그아웃 효과) */
  deactivateUser: masterProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.update(users).set({ isActive: false }).where(eq(users.id, input.userId));
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name ?? "master",
        action: "update",
        target: "user_session",
        targetId: input.userId,
        details: { action: "deactivate" },
      });
      return { ok: true };
    }),

  /** 사용자 재활성화 */
  reactivateUser: masterProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.update(users).set({ isActive: true }).where(eq(users.id, input.userId));
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name ?? "master",
        action: "update",
        target: "user_session",
        targetId: input.userId,
        details: { action: "reactivate" },
      });
      return { ok: true };
    }),

  /** 비밀번호 초기화 (기본 비밀번호 1111) */
  resetPassword: masterProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash("1111", 10);
      await db.update(users).set({ passwordHash: hash, mustChangePassword: true } as any).where(eq(users.id, input.userId));
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name ?? "master",
        action: "update",
        target: "user_password",
        targetId: input.userId,
        details: { action: "reset_to_default" },
      });
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 시스템 설정
  // ═══════════════════════════════════════════════════════════════════════════

  /** 전체 설정 조회 */
  getSettings: masterProcedure.query(async () => {
    return db.select().from(systemSettings).orderBy(systemSettings.settingKey);
  }),

  /** 설정 값 변경 */
  updateSetting: masterProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db.update(systemSettings)
        .set({ settingValue: input.value, updatedBy: ctx.user.userId })
        .where(eq(systemSettings.settingKey, input.key));
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name ?? "master",
        action: "update",
        target: "system_setting",
        details: { key: input.key, value: input.value },
      });
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. API 사용량
  // ═══════════════════════════════════════════════════════════════════════════

  /** API 사용량 요약 */
  apiUsageSummary: masterProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 86400000);

      const byType = await db.select({
        apiType: apiUsageLogs.apiType,
        count: sql<number>`COUNT(*)`,
        avgResponseMs: sql<number>`ROUND(AVG(${apiUsageLogs.responseTimeMs}))`,
        successCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = TRUE THEN 1 ELSE 0 END)`,
        failCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = FALSE THEN 1 ELSE 0 END)`,
      }).from(apiUsageLogs)
        .where(gte(apiUsageLogs.createdAt, since))
        .groupBy(apiUsageLogs.apiType);

      const dailyTrend = await db.select({
        date: sql<string>`DATE(${apiUsageLogs.createdAt})`,
        apiType: apiUsageLogs.apiType,
        count: sql<number>`COUNT(*)`,
      }).from(apiUsageLogs)
        .where(gte(apiUsageLogs.createdAt, since))
        .groupBy(sql`DATE(${apiUsageLogs.createdAt})`, apiUsageLogs.apiType)
        .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);

      return { byType, dailyTrend };
    }),

  /** API 사용 최근 로그 */
  apiUsageList: masterProcedure
    .input(z.object({ limit: z.number().default(30), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const rows = await db.select().from(apiUsageLogs)
        .orderBy(desc(apiUsageLogs.createdAt))
        .limit(input.limit).offset(input.offset);
      const [countRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(apiUsageLogs);
      return { rows, total: countRow?.count ?? 0 };
    }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. 데이터 정합성 체크
  // ═══════════════════════════════════════════════════════════════════════════

  dataIntegrityCheck: masterProcedure.query(async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const today = now.getDate();

    // 매장 목록
    const allStores = await db.select({ id: restaurants.id, name: restaurants.name })
      .from(restaurants).where(and(isNull(restaurants.deletedAt), eq(restaurants.isTutorial, false)));

    const issues: { type: string; severity: "warning" | "error" | "info"; store: string; message: string }[] = [];

    for (const store of allStores) {
      const monthStart = new Date(year, month - 1, 1);
      const todayDate = new Date(year, month - 1, today);

      // 매출 누락일 체크
      const salesDays = await db.select({ d: sql<string>`DATE(${sales.saleDate})` })
        .from(sales)
        .where(and(
          eq(sales.restaurantId, store.id),
          gte(sales.saleDate, monthStart),
          lte(sales.saleDate, todayDate),
        ));
      const salesDaySet = new Set(salesDays.map(r => String(r.d)));
      const missingSalesDays: string[] = [];
      for (let d = 1; d <= today; d++) {
        const ds = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (!salesDaySet.has(ds)) missingSalesDays.push(`${d}일`);
      }
      if (missingSalesDays.length > 0 && missingSalesDays.length <= today - 1) {
        issues.push({
          type: "missing_sales",
          severity: "warning",
          store: store.name,
          message: `이번 달 매출 미입력: ${missingSalesDays.join(", ")}`,
        });
      }

      // 일마감 누락 체크
      const closingDays = await db.select({ d: sql<string>`DATE(${dailyClosings.closingDate})` })
        .from(dailyClosings)
        .where(and(
          eq(dailyClosings.restaurantId, store.id),
          gte(dailyClosings.closingDate, monthStart),
          lte(dailyClosings.closingDate, todayDate),
        ));
      const closingCount = closingDays.length;
      if (closingCount < today - 2 && today > 3) {
        issues.push({
          type: "missing_closing",
          severity: "warning",
          store: store.name,
          message: `일마감 ${closingCount}/${today - 1}일 완료 (${today - 1 - closingCount}일 누락)`,
        });
      }

      // 고정비 미입력 체크
      const monthStr = `${year}-${String(month).padStart(2, "0")}`;
      const [fixedRow] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(fixedCosts)
        .where(and(eq(fixedCosts.restaurantId, store.id), eq(fixedCosts.effectiveMonth, monthStr)));
      if ((fixedRow?.count ?? 0) === 0 && today > 5) {
        issues.push({
          type: "missing_fixed_cost",
          severity: "info",
          store: store.name,
          message: `이번 달 고정비 미입력`,
        });
      }

      // 직원 미배정 체크
      const [staffRow] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(restaurantUsers)
        .where(eq(restaurantUsers.restaurantId, store.id));
      if ((staffRow?.count ?? 0) === 0) {
        issues.push({
          type: "no_staff",
          severity: "error",
          store: store.name,
          message: `배정된 직원이 없음`,
        });
      }
    }

    return { issues, checkedAt: new Date().toISOString(), storeCount: allStores.length };
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. DB 백업
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // 6.5 [임시] 전화번호 로그인 도입 전 감사 (조사 후 revert 예정)
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * READ-ONLY. users.phone 컬럼의 중복/정규화/충돌 조사.
   * 결과 화면 노출 시 마스킹 처리. 본 엔드포인트는 조사 완료 후 revert.
   */
  auditPhoneDuplicates: masterProcedure.query(async () => {
    const allUsers = await db
      .select({ id: users.id, username: users.username, phone: users.phone })
      .from(users);

    const normalize = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      let s = String(raw).trim();
      if (!s) return null;
      s = s.replace(/^\+?82[-\s]?/, "0");
      s = s.replace(/[^\d]/g, "");
      return s || null;
    };
    const mask = (phone: string | null): string => {
      if (!phone) return "-";
      if (phone.length < 4) return "****";
      return "*".repeat(phone.length - 4) + phone.slice(-4);
    };

    const rawMap = new Map<string, number[]>();
    const normMap = new Map<string, { id: number; username: string; masked: string }[]>();
    const lenDist = new Map<number, number>();
    let nullCount = 0;
    let emptyCount = 0;

    for (const u of allUsers) {
      if (u.phone === null) { nullCount++; continue; }
      if (u.phone === "") { emptyCount++; continue; }
      if (!rawMap.has(u.phone)) rawMap.set(u.phone, []);
      rawMap.get(u.phone)!.push(u.id);

      const n = normalize(u.phone);
      if (n) {
        if (!normMap.has(n)) normMap.set(n, []);
        normMap.get(n)!.push({ id: u.id, username: u.username, masked: mask(n) });
        lenDist.set(n.length, (lenDist.get(n.length) ?? 0) + 1);
      }
    }

    const rawDuplicates = Array.from(rawMap.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([phone, ids]) => ({ masked: mask(phone), count: ids.length, ids }));

    const normalizedDuplicates = Array.from(normMap.entries())
      .filter(([, rows]) => rows.length > 1)
      .map(([normalized, rows]) => ({
        masked: mask(normalized),
        count: rows.length,
        rows,
      }));

    const numericOnlyUsernames = allUsers
      .filter((u) => /^[0-9]+$/.test(u.username))
      .map((u) => ({
        id: u.id,
        username: u.username,
        phoneMasked: mask(normalize(u.phone)),
      }));

    return {
      overview: {
        total: allUsers.length,
        nullPhone: nullCount,
        emptyPhone: emptyCount,
        withPhone: allUsers.length - nullCount - emptyCount,
      },
      rawDuplicates,
      normalizedDuplicates,
      numericOnlyUsernames,
      lengthDistribution: Array.from(lenDist.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([length, count]) => ({ length, count })),
    };
  }),

  /** 백업 로그 목록 */
  backupList: masterProcedure.query(async () => {
    return db.select().from(dbBackupLogs).orderBy(desc(dbBackupLogs.createdAt)).limit(30);
  }),

  /** 수동 백업 트리거 */
  triggerBackup: masterProcedure.mutation(async ({ ctx }) => {
    const startTime = Date.now();
    try {
      const mysql2 = await import("mysql2/promise");
      const conn = await mysql2.createConnection(process.env.DATABASE_URL!);
      const fs = await import("fs");
      const path = await import("path");

      // 백업 디렉토리
      const backupDir = path.resolve("backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const now = new Date();
      const fileName = `backup_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}.sql`;
      const filePath = path.join(backupDir, fileName);

      // 모든 테이블 덤프 (INSERT 문 형식)
      const [tables] = await conn.query("SHOW TABLES") as any[];
      const tableNames = tables.map((t: any) => Object.values(t)[0] as string);

      let sqlContent = `-- 331 Restaurant Manager DB Backup\n-- Date: ${now.toISOString()}\n-- Tables: ${tableNames.length}\n\nSET FOREIGN_KEY_CHECKS = 0;\n\n`;

      for (const table of tableNames) {
        const [createResult] = await conn.query(`SHOW CREATE TABLE \`${table}\``) as any[];
        sqlContent += `DROP TABLE IF EXISTS \`${table}\`;\n`;
        sqlContent += createResult[0]["Create Table"] + ";\n\n";

        const [rows] = await conn.query(`SELECT * FROM \`${table}\``) as any[];
        if (rows.length > 0) {
          const cols = Object.keys(rows[0]);
          for (const row of rows) {
            const vals = cols.map((c: string) => {
              const v = row[c];
              if (v === null) return "NULL";
              if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
              if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "\\'")}'`;
              return `'${String(v).replace(/'/g, "\\'")}'`;
            });
            sqlContent += `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(",")}) VALUES (${vals.join(",")});\n`;
          }
          sqlContent += "\n";
        }
      }
      sqlContent += "SET FOREIGN_KEY_CHECKS = 1;\n";

      fs.writeFileSync(filePath, sqlContent, "utf8");
      const fileSizeBytes = fs.statSync(filePath).size;
      const durationMs = Date.now() - startTime;

      await conn.end();

      // 로그 기록
      await db.insert(dbBackupLogs).values({
        fileName,
        fileSizeBytes,
        tableCount: tableNames.length,
        status: "success",
        durationMs,
      });

      // 감사 로그
      await db.insert(auditLogs).values({
        userId: ctx.user.userId,
        userName: ctx.user.name ?? "master",
        action: "create",
        target: "db_backup",
        details: { fileName, fileSizeBytes, tableCount: tableNames.length, durationMs },
      });

      return { ok: true, fileName, fileSizeBytes, tableCount: tableNames.length, durationMs };
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      await db.insert(dbBackupLogs).values({
        fileName: "failed_" + new Date().toISOString(),
        status: "failed",
        errorMessage: e.message,
        durationMs,
      });
      return { ok: false, error: e.message };
    }
  }),

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. 계약서 SSOT vs 박제 정합성 점검 (재설계 2026-05-02 §4 / Phase D [16])
  // ═══════════════════════════════════════════════════════════════════════════

  /** 모든 매장의 직원별 SSOT vs 최신 서명 계약서 스냅샷 diff */
  contractSnapshotAudit: masterProcedure.query(async () => {
    const ru = await db
      .select({
        userId: restaurantUsers.userId,
        restaurantId: restaurantUsers.restaurantId,
        userName: users.name,
        userPhone: users.phone,
        restaurantName: restaurants.name,
        affiliatedCompany: restaurantUsers.affiliatedCompany,
        hireDate: restaurantUsers.hireDate,
        weeklyOffDays: restaurantUsers.weeklyOffDays,
        contractOffDays: restaurantUsers.contractOffDays,
      })
      .from(restaurantUsers)
      .innerJoin(users, eq(users.id, restaurantUsers.userId))
      .innerJoin(restaurants, eq(restaurants.id, restaurantUsers.restaurantId))
      .where(and(
        isNull(restaurantUsers.resignedAt),
        eq(users.isActive, true),
      ));

    if (ru.length === 0) return { rows: [], summary: { total: 0, mismatched: 0, noContract: 0 } };

    // 매장-회사 마스터 매핑 (effectiveOver5)
    const ac = await db
      .select({
        restaurantId: affiliatedCompanies.restaurantId,
        companyName: affiliatedCompanies.companyName,
        over5Employees: affiliatedCompanies.over5Employees,
      })
      .from(affiliatedCompanies);
    const over5Key = (rid: number, c: string) => `${rid}::${c}`;
    const over5Map = new Map<string, boolean>();
    for (const x of ac) over5Map.set(over5Key(x.restaurantId, x.companyName), Boolean(x.over5Employees));

    // 직원별 최신 서명 계약서 조회 (한 번에)
    const userIds = Array.from(new Set(ru.map((r) => r.userId)));
    const restaurantIds = Array.from(new Set(ru.map((r) => r.restaurantId)));
    const snaps = await db
      .select({
        employeeId: employmentElectronicContracts.employeeId,
        restaurantId: employmentElectronicContracts.restaurantId,
        signedAt: employmentElectronicContracts.signedAt,
        snapshotAffiliatedCompany: employmentElectronicContracts.snapshotAffiliatedCompany,
        snapshotHireDate: employmentElectronicContracts.snapshotHireDate,
        snapshotWeeklyOffDays: employmentElectronicContracts.snapshotWeeklyOffDays,
        snapshotContractOffDays: employmentElectronicContracts.snapshotContractOffDays,
        contractOffDays: employmentElectronicContracts.contractOffDays,
        snapshotOver5Employees: employmentElectronicContracts.snapshotOver5Employees,
        snapshotTaxMode: employmentElectronicContracts.snapshotTaxMode,
      })
      .from(employmentElectronicContracts)
      .where(and(
        eq(employmentElectronicContracts.status, "signed"),
      ))
      .orderBy(desc(employmentElectronicContracts.signedAt));
    void userIds; void restaurantIds; // (전체 fetch 후 메모리에서 매핑 — 직원 수 N=수백 규모)

    const snapKey = (uid: number, rid: number) => `${uid}::${rid}`;
    const snapMap = new Map<string, typeof snaps[number]>();
    for (const s of snaps) {
      if (s.employeeId == null || s.restaurantId == null) continue;
      const k = snapKey(s.employeeId, s.restaurantId);
      if (!snapMap.has(k)) snapMap.set(k, s);
    }

    const dateIso = (d: any) => {
      if (d == null || d === "") return "";
      const dt = d instanceof Date ? d : new Date(d);
      return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
    };

    const rows = ru.map((r) => {
      const snap = snapMap.get(snapKey(r.userId, r.restaurantId)) ?? null;
      const effectiveOver5 = r.affiliatedCompany ? over5Map.get(over5Key(r.restaurantId, r.affiliatedCompany)) ?? false : false;
      const fields: string[] = [];
      if (snap) {
        if ((snap.snapshotAffiliatedCompany ?? "") !== (r.affiliatedCompany ?? "")) fields.push("소속회사");
        if (dateIso(snap.snapshotHireDate) !== dateIso(r.hireDate)) fields.push("입사일");
        // 서명 계약서가 계약휴무일수를 실제로 계약한 경우에만 비교 (legacy 백필 환산값 오탐 방지)
        if (snap.contractOffDays != null && (snap.snapshotContractOffDays ?? null) !== (r.contractOffDays ?? null)) fields.push("계약휴무일수");
        if (snap.snapshotOver5Employees != null && Boolean(snap.snapshotOver5Employees) !== Boolean(effectiveOver5)) fields.push("5인 여부");
      }
      return {
        userId: r.userId,
        userName: r.userName,
        userPhone: r.userPhone,
        restaurantId: r.restaurantId,
        restaurantName: r.restaurantName,
        ssot: {
          affiliatedCompany: r.affiliatedCompany,
          hireDate: r.hireDate ? dateIso(r.hireDate) : null,
          weeklyOffDays: r.weeklyOffDays,
          contractOffDays: r.contractOffDays,
          effectiveOver5,
        },
        snapshot: snap ? {
          signedAt: snap.signedAt,
          affiliatedCompany: snap.snapshotAffiliatedCompany,
          hireDate: dateIso(snap.snapshotHireDate),
          weeklyOffDays: snap.snapshotWeeklyOffDays,
          contractOffDays: snap.snapshotContractOffDays,
          over5Employees: snap.snapshotOver5Employees,
          taxMode: snap.snapshotTaxMode,
        } : null,
        mismatchedFields: fields,
        hasContract: !!snap,
      };
    });

    const mismatched = rows.filter((r) => r.mismatchedFields.length > 0).length;
    const noContract = rows.filter((r) => !r.hasContract).length;

    return {
      rows: rows.sort((a, b) => {
        // 갱신 필요 먼저, 그 다음 계약서 없음, 그 다음 정상
        const aPri = a.mismatchedFields.length > 0 ? 0 : !a.hasContract ? 1 : 2;
        const bPri = b.mismatchedFields.length > 0 ? 0 : !b.hasContract ? 1 : 2;
        if (aPri !== bPri) return aPri - bPri;
        return (a.restaurantName || "").localeCompare(b.restaurantName || "");
      }),
      summary: { total: rows.length, mismatched, noContract },
    };
  }),
});
