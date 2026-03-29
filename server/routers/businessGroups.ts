import { z } from "zod";
import { eq, and, sql, isNull } from "drizzle-orm";
import { router, masterProcedure, adminProcedure } from "../trpc";
import { db } from "../db";
import { businessGroups, users, restaurants, restaurantUsers } from "../../drizzle/schema";
import { hashPassword } from "../auth";

export const businessGroupsRouter = router({
  /**
   * 사업그룹 목록 — 그룹별 대표명, 매장수, 직원수 포함
   * master: 전체, admin: 자기 그룹만
   */
  list: masterProcedure.query(async () => {
    const groups = await db.select().from(businessGroups);

    // 그룹별 상세 집계
    const enriched = await Promise.all(
      groups.map(async (g) => {
        // 대표 정보
        const [admin] = await db
          .select({ id: users.id, name: users.name, username: users.username, phone: users.phone })
          .from(users)
          .where(eq(users.id, g.adminId))
          .limit(1);

        // 소속 매장 (tutorial 그룹은 tutorial 매장 포함)
        const storeConditions = [
          eq(restaurants.ownerAdminId, g.adminId),
          isNull(restaurants.deletedAt),
        ];
        const storeRows = await db
          .select({ id: restaurants.id, name: restaurants.name, isActive: restaurants.isActive, isTutorial: restaurants.isTutorial })
          .from(restaurants)
          .where(and(...storeConditions));

        // 소속 직원 (매장 경유)
        const storeIds = storeRows.map((s) => s.id);
        let staffCount = 0;
        if (storeIds.length > 0) {
          const [row] = await db
            .select({ count: sql<number>`COUNT(DISTINCT ${restaurantUsers.userId})` })
            .from(restaurantUsers)
            .where(sql`${restaurantUsers.restaurantId} IN (${sql.raw(storeIds.join(","))})`);
          staffCount = row?.count ?? 0;
        }

        // SUB대표 수
        const [subRow] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.parentId, g.adminId)));

        return {
          ...g,
          admin: admin ?? null,
          stores: storeRows,
          storeCount: storeRows.length,
          staffCount,
          subAdminCount: subRow?.count ?? 0,
        };
      })
    );

    return enriched;
  }),

  /**
   * 사업그룹 생성 — 대표 계정 + 그룹을 한번에 생성
   * master 전용
   */
  create: masterProcedure
    .input(
      z.object({
        groupName: z.string().min(1).max(100),
        // 기존 admin userId로 연결하거나, 새 admin 계정 생성
        existingAdminId: z.number().optional(),
        // 새 admin 생성 시 필요
        newAdmin: z
          .object({
            username: z.string().min(2),
            password: z.string().min(4),
            name: z.string().min(1),
            phone: z.string().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      let adminId: number;

      if (input.existingAdminId) {
        // 기존 admin으로 연결
        const [admin] = await db
          .select()
          .from(users)
          .where(eq(users.id, input.existingAdminId))
          .limit(1);
        if (!admin || admin.role !== "admin")
          throw new Error("유효한 대표(admin) 계정이 아닙니다");
        // 이미 그룹이 있는지 체크
        const [existing] = await db
          .select()
          .from(businessGroups)
          .where(eq(businessGroups.adminId, input.existingAdminId))
          .limit(1);
        if (existing) throw new Error("이미 사업그룹이 존재하는 대표입니다");
        adminId = input.existingAdminId;
      } else if (input.newAdmin) {
        // 새 admin 계정 생성
        const existing = await db
          .select()
          .from(users)
          .where(eq(users.username, input.newAdmin.username))
          .limit(1);
        if (existing.length > 0) throw new Error("이미 존재하는 아이디입니다");

        const hash = await hashPassword(input.newAdmin.password);
        const [result] = await db
          .insert(users)
          .values({
            username: input.newAdmin.username,
            passwordHash: hash,
            name: input.newAdmin.name,
            role: "admin",
            phone: input.newAdmin.phone,
          })
          .$returningId();
        adminId = result.id;
      } else {
        throw new Error("기존 대표 ID 또는 새 대표 정보가 필요합니다");
      }

      // 사업그룹 레코드 생성
      const [group] = await db
        .insert(businessGroups)
        .values({
          name: input.groupName,
          adminId,
        })
        .$returningId();

      return { id: group.id, adminId };
    }),

  /**
   * 사업그룹 수정 (이름, 설명, 활성상태)
   */
  update: masterProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(businessGroups).set(data).where(eq(businessGroups.id, id));
      return { ok: true };
    }),

  /**
   * 매장을 사업그룹에 배정 (ownerAdminId 설정)
   */
  assignStore: masterProcedure
    .input(z.object({ restaurantId: z.number(), groupId: z.number().nullable() }))
    .mutation(async ({ input }) => {
      if (input.groupId === null) {
        // 미배정
        await db.update(restaurants).set({ ownerAdminId: null }).where(eq(restaurants.id, input.restaurantId));
      } else {
        const [group] = await db
          .select()
          .from(businessGroups)
          .where(eq(businessGroups.id, input.groupId))
          .limit(1);
        if (!group) throw new Error("사업그룹을 찾을 수 없습니다");
        await db
          .update(restaurants)
          .set({ ownerAdminId: group.adminId })
          .where(eq(restaurants.id, input.restaurantId));
      }
      return { ok: true };
    }),
});
