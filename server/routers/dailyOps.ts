import { z } from "zod";
import { eq, and, sql, sum, between, count } from "drizzle-orm";
import { router, protectedProcedure, managerProcedure } from "../trpc";
import { db } from "../db";
import {
  dailyOperations,
  dailySalesDetail,
  salesOtherItems,
  salesOtherItemTemplates,
  dailySalesSpecialItems,
  intermediateSales,
  dailyOrderImages,
  schedules,
  users,
  dailyChecklistLogs,
  storeChecklistTemplates,
  purchaseOrdersV2,
  purchaseOrderItemsV2,
  counterparties,
} from "../../drizzle/schema";

export const dailyOpsRouter = router({
  /** 오늘 운영 현황 조회 */
  getByDate: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} = ${input.date}`
          )
        )
        .limit(1);
      return row ?? null;
    }),

  /** 오픈 체크 */
  checkOpen: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        headcount: z.number().optional(),
        laborCost: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} = ${input.date}`
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(dailyOperations)
          .set({
            openCheckedAt: new Date(),
            openCheckedBy: ctx.user.userId,
            openHeadcount: input.headcount ?? 0,
            openLaborCost: input.laborCost ? String(input.laborCost) : "0",
          })
          .where(eq(dailyOperations.id, existing.id));
        return { id: existing.id };
      }

      const [result] = await db.insert(dailyOperations).values({
        restaurantId: input.restaurantId,
        operationDate: input.date,
        openCheckedAt: new Date(),
        openCheckedBy: ctx.user.userId,
        openHeadcount: input.headcount ?? 0,
        openLaborCost: input.laborCost ? String(input.laborCost) : "0",
      } as any);
      return { id: (result as any).insertId };
    }),

  /** 마감 체크 */
  checkClose: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        headcount: z.number().optional(),
        laborCost: z.number().optional(),
        closeNote: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [existing] = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} = ${input.date}`
          )
        )
        .limit(1);

      if (existing) {
        await db
          .update(dailyOperations)
          .set({
            closeCheckedAt: new Date(),
            closeCheckedBy: ctx.user.userId,
            closeHeadcount: input.headcount ?? 0,
            closeLaborCost: input.laborCost ? String(input.laborCost) : "0",
            closeNote: input.closeNote,
          })
          .where(eq(dailyOperations.id, existing.id));
        return { id: existing.id };
      }

      const [result] = await db.insert(dailyOperations).values({
        restaurantId: input.restaurantId,
        operationDate: input.date,
        closeCheckedAt: new Date(),
        closeCheckedBy: ctx.user.userId,
        closeHeadcount: input.headcount ?? 0,
        closeLaborCost: input.laborCost ? String(input.laborCost) : "0",
        closeNote: input.closeNote,
      } as any);
      return { id: (result as any).insertId };
    }),

  // ─── 어제 마감 요약 ─────────────────────────────────────────────────────
  getYesterdaySummary: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      // date의 전일
      const d = new Date(input.date);
      d.setDate(d.getDate() - 1);
      const yesterday = d.toISOString().slice(0, 10);

      const [ops] = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} = ${yesterday}`
          )
        )
        .limit(1);

      const [sales] = await db
        .select()
        .from(dailySalesDetail)
        .where(
          and(
            eq(dailySalesDetail.restaurantId, input.restaurantId),
            sql`${dailySalesDetail.saleDate} = ${yesterday}`
          )
        )
        .limit(1);

      return {
        date: yesterday,
        closeCheckedAt: ops?.closeCheckedAt ?? null,
        closeNote: ops?.closeNote ?? null,
        totalSales: sales ? Number(sales.totalAmount) : null,
        cashAmount: sales ? Number(sales.cashAmount) : null,
        cardAmount: sales ? Number(sales.cardAmount) : null,
      };
    }),

  // ─── 해당 요일 평균 매출 (최근 8주) ──────────────────────────────────────
  getWeekdayAvgSales: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const d = new Date(input.date);
      const dayOfWeek = d.getDay(); // 0=Sun, 6=Sat
      // 최근 8주 이내 같은 요일의 매출 평균
      const eightWeeksAgo = new Date(d);
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      const startStr = eightWeeksAgo.toISOString().slice(0, 10);

      const rows = await db
        .select({ total: dailySalesDetail.totalAmount })
        .from(dailySalesDetail)
        .where(
          and(
            eq(dailySalesDetail.restaurantId, input.restaurantId),
            sql`${dailySalesDetail.saleDate} >= ${startStr}`,
            sql`${dailySalesDetail.saleDate} < ${input.date}`,
            sql`DAYOFWEEK(${dailySalesDetail.saleDate}) = ${dayOfWeek + 1}` // MySQL: 1=Sun
          )
        );

      if (rows.length === 0) return { avg: null, count: 0 };
      const total = rows.reduce((s, r) => s + Number(r.total), 0);
      return { avg: Math.round(total / rows.length), count: rows.length };
    }),

  // ─── 금일 출근 인원 (확정 스케줄 기반) ──────────────────────────────────
  getTodayStaff: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          userName: users.name,
          startTime: schedules.startTime,
          endTime: schedules.endTime,
        })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            sql`DATE(${schedules.startTime}) = ${input.date}`,
            eq(schedules.status, "confirmed")
          )
        );

      return { headcount: rows.length, staff: rows };
    }),

  // ─── 중간매출 ──────────────────────────────────────────────────────────
  getMidSales: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(intermediateSales)
        .where(
          and(
            eq(intermediateSales.restaurantId, input.restaurantId),
            sql`${intermediateSales.saleDate} = ${input.date}`
          )
        );
      return rows;
    }),

  saveMidSales: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        amount: z.number(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(intermediateSales).values({
        restaurantId: input.restaurantId,
        saleDate: input.date,
        amount: String(input.amount),
        note: input.note,
        recordedBy: ctx.user.userId,
      } as any);
      return { id: (result as any).insertId };
    }),

  deleteMidSales: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(intermediateSales).where(eq(intermediateSales.id, input.id));
      return { ok: true };
    }),

  // ─── 발주 이미지 ────────────────────────────────────────────────────────
  getOrderImages: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(dailyOrderImages)
        .where(
          and(
            eq(dailyOrderImages.restaurantId, input.restaurantId),
            sql`${dailyOrderImages.imageDate} = ${input.date}`
          )
        );
    }),

  saveOrderImage: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        imageUrl: z.string(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const [result] = await db.insert(dailyOrderImages).values({
        restaurantId: input.restaurantId,
        imageDate: input.date,
        imageUrl: input.imageUrl,
        note: input.note,
        uploadedBy: ctx.user.userId,
      } as any);
      return { id: (result as any).insertId };
    }),

  deleteOrderImage: managerProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(dailyOrderImages).where(eq(dailyOrderImages.id, input.id));
      return { ok: true };
    }),

  // ─── 마감 매출 입력/조회 ─────────────────────────────────────────────────
  getDailySales: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      const [detail] = await db
        .select()
        .from(dailySalesDetail)
        .where(
          and(
            eq(dailySalesDetail.restaurantId, input.restaurantId),
            sql`${dailySalesDetail.saleDate} = ${input.date}`
          )
        )
        .limit(1);

      if (!detail) return null;

      const otherItems = await db
        .select()
        .from(salesOtherItems)
        .where(eq(salesOtherItems.dailySalesDetailId, detail.id));

      const specialItems = await db
        .select()
        .from(dailySalesSpecialItems)
        .where(eq(dailySalesSpecialItems.dailySalesDetailId, detail.id));

      return { ...detail, otherItems, specialItems };
    }),

  saveDailySales: managerProcedure
    .input(
      z.object({
        restaurantId: z.number(),
        date: z.string(),
        cashAmount: z.number(),
        cardAmount: z.number(),
        giftCardAmount: z.number().default(0),
        transferAmount: z.number().default(0),
        otherItems: z.array(z.object({ itemName: z.string(), amount: z.number() })).default([]),
        specialItems: z.array(z.object({ typeName: z.string(), amount: z.number(), note: z.string().optional() })).default([]),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const otherTotal = input.otherItems.reduce((s, i) => s + i.amount, 0);
      const specialTotal = input.specialItems.reduce((s, i) => s + i.amount, 0);
      const totalAmount =
        input.cashAmount + input.cardAmount + input.giftCardAmount + input.transferAmount + otherTotal;

      // upsert dailySalesDetail
      const [existing] = await db
        .select()
        .from(dailySalesDetail)
        .where(
          and(
            eq(dailySalesDetail.restaurantId, input.restaurantId),
            sql`${dailySalesDetail.saleDate} = ${input.date}`
          )
        )
        .limit(1);

      let detailId: number;
      const data = {
        cashAmount: String(input.cashAmount),
        cardAmount: String(input.cardAmount),
        giftCardAmount: String(input.giftCardAmount),
        transferAmount: String(input.transferAmount),
        otherAmount: String(otherTotal),
        discountAmount: String(specialTotal),
        totalAmount: String(totalAmount),
        note: input.note,
        recordedBy: ctx.user.userId,
        status: "submitted" as const,
      };

      if (existing) {
        await db.update(dailySalesDetail).set(data).where(eq(dailySalesDetail.id, existing.id));
        detailId = existing.id;
        // 기존 otherItems/specialItems 삭제 후 재입력
        await db.delete(salesOtherItems).where(eq(salesOtherItems.dailySalesDetailId, detailId));
        await db.delete(dailySalesSpecialItems).where(eq(dailySalesSpecialItems.dailySalesDetailId, detailId));
      } else {
        const [result] = await db.insert(dailySalesDetail).values({
          restaurantId: input.restaurantId,
          saleDate: input.date,
          ...data,
        } as any);
        detailId = (result as any).insertId;
      }

      // 기타 매출 항목
      for (const item of input.otherItems) {
        await db.insert(salesOtherItems).values({
          dailySalesDetailId: detailId,
          restaurantId: input.restaurantId,
          itemName: item.itemName,
          amount: String(item.amount),
        } as any);
        // 템플릿 자동 등록 (중복 체크)
        const [tmpl] = await db
          .select()
          .from(salesOtherItemTemplates)
          .where(
            and(
              eq(salesOtherItemTemplates.restaurantId, input.restaurantId),
              eq(salesOtherItemTemplates.itemName, item.itemName)
            )
          )
          .limit(1);
        if (!tmpl) {
          await db.insert(salesOtherItemTemplates).values({
            restaurantId: input.restaurantId,
            itemName: item.itemName,
          } as any);
        }
      }

      // 특이사항
      for (const item of input.specialItems) {
        await db.insert(dailySalesSpecialItems).values({
          dailySalesDetailId: detailId,
          restaurantId: input.restaurantId,
          typeName: item.typeName,
          amount: String(item.amount),
          note: item.note,
        } as any);
      }

      return { id: detailId, totalAmount };
    }),

  // ─── 기타 매출 유형 템플릿 조회 ──────────────────────────────────────────
  getOtherItemTemplates: protectedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(salesOtherItemTemplates)
        .where(eq(salesOtherItemTemplates.restaurantId, input.restaurantId));
    }),

  // ─── 운영 캘린더 (월간 요약) ──────────────────────────────────────────────
  getMonthlyCalendar: protectedProcedure
    .input(z.object({ restaurantId: z.number(), year: z.number(), month: z.number() }))
    .query(async ({ input }) => {
      const startDate = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
      const endDate =
        input.month === 12
          ? `${input.year + 1}-01-01`
          : `${input.year}-${String(input.month + 1).padStart(2, "0")}-01`;

      // 일별 운영 현황
      const ops = await db
        .select()
        .from(dailyOperations)
        .where(
          and(
            eq(dailyOperations.restaurantId, input.restaurantId),
            sql`${dailyOperations.operationDate} >= ${startDate}`,
            sql`${dailyOperations.operationDate} < ${endDate}`
          )
        );

      // 일별 매출
      const sales = await db
        .select()
        .from(dailySalesDetail)
        .where(
          and(
            eq(dailySalesDetail.restaurantId, input.restaurantId),
            sql`${dailySalesDetail.saleDate} >= ${startDate}`,
            sql`${dailySalesDetail.saleDate} < ${endDate}`
          )
        );

      // ─── 체크리스트 완료 현황 ───
      const checklistLogs = await db
        .select()
        .from(dailyChecklistLogs)
        .where(
          and(
            eq(dailyChecklistLogs.restaurantId, input.restaurantId),
            sql`${dailyChecklistLogs.logDate} >= ${startDate}`,
            sql`${dailyChecklistLogs.logDate} < ${endDate}`
          )
        );

      // 체크리스트 템플릿 수 (타입별)
      const templates = await db
        .select({ checkType: storeChecklistTemplates.checkType, cnt: count() })
        .from(storeChecklistTemplates)
        .where(eq(storeChecklistTemplates.restaurantId, input.restaurantId))
        .groupBy(storeChecklistTemplates.checkType);
      const templateCounts: Record<string, number> = {};
      for (const t of templates) {
        templateCounts[t.checkType] = Number(t.cnt);
      }

      // 날짜별 체크리스트 완료율 맵
      const checklistByDate: Record<string, { checked: number; total: number; types: string[] }> = {};
      for (const log of checklistLogs) {
        const dateStr = typeof log.logDate === "string"
          ? log.logDate
          : (log.logDate as Date).toISOString().slice(0, 10);
        if (!checklistByDate[dateStr]) {
          checklistByDate[dateStr] = { checked: 0, total: 0, types: [] };
        }
        const checkedCount = (log.checkedItemIds as number[] || []).length;
        const totalForType = templateCounts[log.checkType] ?? 0;
        checklistByDate[dateStr].checked += checkedCount;
        checklistByDate[dateStr].total += totalForType;
        if (checkedCount >= totalForType && totalForType > 0) {
          checklistByDate[dateStr].types.push(log.checkType);
        }
      }

      // ─── 스케줄 완료 현황 ───
      const monthSchedules = await db
        .select({
          startTime: schedules.startTime,
          status: schedules.status,
        })
        .from(schedules)
        .where(
          and(
            eq(schedules.restaurantId, input.restaurantId),
            sql`${schedules.startTime} >= ${startDate}`,
            sql`${schedules.startTime} < ${endDate}`,
            sql`${schedules.status} IN ('confirmed', 'completed', 'draft')`
          )
        );

      const scheduleByDate: Record<string, { total: number; completed: number; confirmed: number }> = {};
      for (const sch of monthSchedules) {
        const d = sch.startTime instanceof Date ? sch.startTime : new Date(sch.startTime as string);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (!scheduleByDate[dateStr]) {
          scheduleByDate[dateStr] = { total: 0, completed: 0, confirmed: 0 };
        }
        scheduleByDate[dateStr].total++;
        if (sch.status === "completed") scheduleByDate[dateStr].completed++;
        if (sch.status === "confirmed") scheduleByDate[dateStr].confirmed++;
      }

      // 날짜별 맵 구성
      const days: Record<
        string,
        {
          date: string;
          openCheckedAt: string | null;
          closeCheckedAt: string | null;
          openHeadcount: number;
          closeHeadcount: number;
          totalSales: number;
          status: "none" | "open" | "closed";
          checklist: { checked: number; total: number; types: string[] } | null;
          schedule: { total: number; completed: number; confirmed: number } | null;
        }
      > = {};

      const ensureDay = (dateStr: string) => {
        if (!days[dateStr]) {
          days[dateStr] = {
            date: dateStr,
            openCheckedAt: null,
            closeCheckedAt: null,
            openHeadcount: 0,
            closeHeadcount: 0,
            totalSales: 0,
            status: "none",
            checklist: null,
            schedule: null,
          };
        }
      };

      for (const op of ops) {
        const dateStr = typeof op.operationDate === "string"
          ? op.operationDate
          : (op.operationDate as Date).toISOString().slice(0, 10);
        ensureDay(dateStr);
        days[dateStr].openCheckedAt = op.openCheckedAt ? op.openCheckedAt.toISOString() : null;
        days[dateStr].closeCheckedAt = op.closeCheckedAt ? op.closeCheckedAt.toISOString() : null;
        days[dateStr].openHeadcount = op.openHeadcount ?? 0;
        days[dateStr].closeHeadcount = op.closeHeadcount ?? 0;
        days[dateStr].status = op.closeCheckedAt ? "closed" : op.openCheckedAt ? "open" : "none";
      }

      for (const s of sales) {
        const dateStr = typeof s.saleDate === "string"
          ? s.saleDate
          : (s.saleDate as Date).toISOString().slice(0, 10);
        ensureDay(dateStr);
        days[dateStr].totalSales = Number(s.totalAmount);
      }

      // 체크리스트/스케줄 데이터 병합
      for (const dateStr of Object.keys(checklistByDate)) {
        ensureDay(dateStr);
        days[dateStr].checklist = checklistByDate[dateStr];
      }
      for (const dateStr of Object.keys(scheduleByDate)) {
        ensureDay(dateStr);
        days[dateStr].schedule = scheduleByDate[dateStr];
      }

      // 월 합계
      const totalSales = sales.reduce((s, r) => s + Number(r.totalAmount), 0);
      const closedDays = ops.filter((o) => o.closeCheckedAt).length;

      return { days, totalSales, closedDays };
    }),

  // ─── 일별 상세 (운영캘린더 우측 패널용) ──────────────────────────────────
  getDayDetail: protectedProcedure
    .input(z.object({ restaurantId: z.number(), date: z.string() }))
    .query(async ({ input }) => {
      // 1. 일일운영 상태
      const [ops] = await db.select().from(dailyOperations)
        .where(and(eq(dailyOperations.restaurantId, input.restaurantId), sql`${dailyOperations.operationDate} = ${input.date}`))
        .limit(1);

      // 2. 매출 상세
      const [salesDetail] = await db.select().from(dailySalesDetail)
        .where(and(eq(dailySalesDetail.restaurantId, input.restaurantId), sql`${dailySalesDetail.saleDate} = ${input.date}`))
        .limit(1);

      // 3. 스케줄 목록
      const scheduleRows = await db
        .select({ id: schedules.id, userName: users.name, startTime: schedules.startTime, endTime: schedules.endTime, status: schedules.status, shiftPreset: schedules.shiftPreset, tempWorkerName: schedules.tempWorkerName })
        .from(schedules)
        .leftJoin(users, eq(schedules.userId, users.id))
        .where(and(eq(schedules.restaurantId, input.restaurantId), sql`DATE(${schedules.startTime}) = ${input.date}`, sql`${schedules.status} != 'canceled'`));

      // 4. 매입 목록
      const purchaseRows = await db
        .select({ id: purchaseOrdersV2.id, counterpartyName: counterparties.name, totalAmount: purchaseOrdersV2.totalAmount, status: purchaseOrdersV2.status, note: purchaseOrdersV2.note })
        .from(purchaseOrdersV2)
        .leftJoin(counterparties, eq(purchaseOrdersV2.counterpartyId, counterparties.id))
        .where(and(eq(purchaseOrdersV2.restaurantId, input.restaurantId), sql`${purchaseOrdersV2.purchaseDate} = ${input.date}`));

      // 5. 체크리스트 로그
      const checklistLogs = await db.select().from(dailyChecklistLogs)
        .where(and(eq(dailyChecklistLogs.restaurantId, input.restaurantId), sql`${dailyChecklistLogs.logDate} = ${input.date}`));

      // 6. 중간매출
      const midSales = await db.select().from(intermediateSales)
        .where(and(eq(intermediateSales.restaurantId, input.restaurantId), sql`${intermediateSales.saleDate} = ${input.date}`));

      return {
        operation: ops ?? null,
        sales: salesDetail ? {
          totalAmount: Number(salesDetail.totalAmount),
          cashAmount: Number(salesDetail.cashAmount),
          cardAmount: Number(salesDetail.cardAmount),
          giftCardAmount: Number(salesDetail.giftCardAmount),
          transferAmount: Number(salesDetail.transferAmount),
          otherAmount: Number(salesDetail.otherAmount),
          status: salesDetail.status,
          note: salesDetail.note,
        } : null,
        schedules: scheduleRows.map(s => ({
          id: s.id,
          name: s.userName ?? s.tempWorkerName ?? "미지정",
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status,
          shiftPreset: s.shiftPreset,
        })),
        purchases: purchaseRows.map(p => ({
          id: p.id,
          counterparty: p.counterpartyName ?? "미지정",
          amount: Number(p.totalAmount),
          status: p.status,
          note: p.note,
        })),
        checklists: checklistLogs.map(c => ({
          checkType: c.checkType,
          checkedCount: (c.checkedItemIds as number[] || []).length,
          noOrderToday: c.noOrderToday,
          completedAt: c.completedAt,
        })),
        midSalesTotal: midSales.reduce((s, m) => s + Number(m.amount), 0),
        purchaseTotal: purchaseRows.reduce((s, p) => s + Number(p.totalAmount), 0),
      };
    }),
});
