import { z } from "zod";
import { eq, and, between, sql, desc, gte, lte, isNull } from "drizzle-orm";
import { router, masterProcedure, adminProcedure } from "../trpc";
import { db } from "../db";
import {
  auditLogs, systemSettings, apiUsageLogs, dbBackupLogs,
  notifications, users, restaurants, sales, dailyClosings, schedules,
  fixedCosts, restaurantUsers,
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
});
