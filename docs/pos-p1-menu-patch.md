# POS P1 본문 #2 — `pos.menu.*` 본문 + 활성화 게이트 적용

> 작성: 2026-04-19 (Cowork)
> 대상: Claude Code 세션
> 선행 PR: ebe32ae (Settings 본문 + posStore*Procedure 게이트)
> 선행 문서: `docs/pos-plan.md` v0.5, `docs/pos-p1-handoff.md`, `docs/pos-p1-settings-enable-patch.md`
> 단계: P1 본문 #2 — 메뉴/카테고리/옵션 CRUD

---

## 0. 사전 조건 (반드시 통과 후 진입)

본 PR은 ebe32ae의 **Settings 본문 시연 통과**가 전제. 통과 못 했으면 settings hotfix 먼저:
- `pos.settings.enable(천호점, 'DEPT_PICKUP')` 후 `posEnabled=true` + 4축 디폴트 정상 주입
- `pos.settings.applyPreset` 동작
- 비-master로 enable 시 `UNAUTHORIZED`/`FORBIDDEN`
- 재호출 시 `BAD_REQUEST`

시연 미통과 상태에서 Menu 본문 진입 금지.

---

## 1. 목적·범위

settings에서 활성화된 매장의 **메뉴/카테고리/옵션 CRUD** 본문 채움.

**범위 (라우터 7개 endpoint)**
- `pos.menu.listCategories` (read)
- `pos.menu.upsertCategory` (manager)
- `pos.menu.deleteCategory` (manager) — 신규
- `pos.menu.listItems` (read)
- `pos.menu.upsertItem` (manager)
- `pos.menu.setSoldOut` (manager)
- `pos.menu.deleteItem` (manager) — 신규
- (옵션) `pos.menu.listOptionGroups` / `upsertOptionGroup` / `deleteOptionGroup` / `upsertOption` / `deleteOption` — Q-O11에 따라 **API 1차** (UI는 2차)

**procedure 교체**: 기존 골격의 `protectedProcedure` / `managerProcedure` → `posStoreReadProcedure` / `posStoreManagerProcedure`로 일괄 교체. 활성화 게이트 + 매장 격리 동시 적용.

**완료 조건**
- `pnpm run build` 통과
- 천호점에서 카테고리 1개 → 메뉴 1개 등록 → 조회 → 품절 토글 → soft delete 흐름 정상
- 비활성 매장에서 호출 시 `FORBIDDEN: POS가 이 매장에 활성화되지 않았습니다`

**Out of Scope (본 PR 미포함)**
- 이미지 업로드 UI (`imageUrl`은 문자열 입력만 받음, 업로드는 P2)
- 재료 차감(`recipeId` 필드는 받지만 차감 로직 없음)
- 옵션 그룹/옵션 UI (DB·API만)

---

## 2. `server/routers/pos.ts` — menu 라우터 본문 (전체 교체)

기존 `menuRouter` 부분을 아래로 교체. import 추가 필요.

### 2.1 Import 보강

```ts
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  posStoreReadProcedure, posStoreManagerProcedure,
} from "../trpc";
import {
  posMenuCategories, posMenuItems,
  posMenuOptionGroups, posMenuOptions,
} from "../../drizzle/schema";
```

### 2.2 menu 라우터 본문

```ts
const menuRouter = router({
  // ─── 카테고리 ─────────────────────────────────────────────────
  listCategories: posStoreReadProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      includeInactive: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const conds = [
        eq(posMenuCategories.restaurantId, input.restaurantId),
        isNull(posMenuCategories.deletedAt),
      ];
      if (!input.includeInactive) {
        conds.push(eq(posMenuCategories.isActive, true));
      }
      return ctx.db.select().from(posMenuCategories)
        .where(and(...conds))
        .orderBy(posMenuCategories.displayOrder, posMenuCategories.id);
    }),

  upsertCategory: posStoreManagerProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      restaurantId: z.number().int().positive(),
      name: z.string().min(1).max(100),
      displayOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        const [existing] = await ctx.db.select().from(posMenuCategories)
          .where(eq(posMenuCategories.id, input.id)).limit(1);
        if (!existing || existing.restaurantId !== input.restaurantId || existing.deletedAt) {
          throw new TRPCError({ code: "NOT_FOUND", message: "카테고리를 찾을 수 없습니다." });
        }
        await ctx.db.update(posMenuCategories)
          .set({
            name: input.name,
            displayOrder: input.displayOrder,
            isActive: input.isActive,
          })
          .where(eq(posMenuCategories.id, input.id));
        return { ok: true, id: input.id, created: false };
      }
      const [result] = await ctx.db.insert(posMenuCategories).values({
        restaurantId: input.restaurantId,
        name: input.name,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
      });
      // mysql2 insertId 위치는 driver 따라 다름. Code가 표준 패턴 확인 후 일치
      const insertId = (result as any).insertId ?? (result as any)[0]?.insertId;
      return { ok: true, id: Number(insertId), created: true };
    }),

  deleteCategory: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 카테고리 매장 일치 검증
      const [existing] = await ctx.db.select().from(posMenuCategories)
        .where(eq(posMenuCategories.id, input.id)).limit(1);
      if (!existing || existing.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // 활성 메뉴 항목 있는지 확인 (soft delete 방지)
      const items = await ctx.db.select({ id: posMenuItems.id })
        .from(posMenuItems)
        .where(and(
          eq(posMenuItems.categoryId, input.id),
          isNull(posMenuItems.deletedAt),
        )).limit(1);
      if (items.length > 0) {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: "이 카테고리에 활성 메뉴가 있습니다. 먼저 메뉴를 삭제하거나 다른 카테고리로 옮기세요.",
        });
      }
      await ctx.db.update(posMenuCategories)
        .set({ deletedAt: new Date() })
        .where(eq(posMenuCategories.id, input.id));
      return { ok: true };
    }),

  // ─── 메뉴 항목 ─────────────────────────────────────────────────
  listItems: posStoreReadProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      categoryId: z.number().int().positive().optional(),
      includeInactive: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const conds = [
        eq(posMenuItems.restaurantId, input.restaurantId),
        isNull(posMenuItems.deletedAt),
      ];
      if (input.categoryId !== undefined) {
        conds.push(eq(posMenuItems.categoryId, input.categoryId));
      }
      if (!input.includeInactive) {
        conds.push(eq(posMenuItems.isActive, true));
      }
      return ctx.db.select().from(posMenuItems)
        .where(and(...conds))
        .orderBy(posMenuItems.displayOrder, posMenuItems.id);
    }),

  upsertItem: posStoreManagerProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      restaurantId: z.number().int().positive(),
      categoryId: z.number().int().positive().optional(),
      name: z.string().min(1).max(150),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/, "가격은 숫자(소수점 둘째자리까지)"),
      imageUrl: z.string().max(500).optional(),
      recipeId: z.number().int().positive().optional(),
      taxType: z.enum(["taxable", "exempt", "zero"]).default("taxable"),
      displayOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // 카테고리 매장 일치 검증
      if (input.categoryId !== undefined) {
        const [cat] = await ctx.db.select().from(posMenuCategories)
          .where(eq(posMenuCategories.id, input.categoryId)).limit(1);
        if (!cat || cat.restaurantId !== input.restaurantId || cat.deletedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "카테고리가 이 매장과 일치하지 않거나 삭제되었습니다.",
          });
        }
      }

      if (input.id) {
        const [existing] = await ctx.db.select().from(posMenuItems)
          .where(eq(posMenuItems.id, input.id)).limit(1);
        if (!existing || existing.restaurantId !== input.restaurantId || existing.deletedAt) {
          throw new TRPCError({ code: "NOT_FOUND", message: "메뉴를 찾을 수 없습니다." });
        }
        const { id, restaurantId, ...patch } = input;
        await ctx.db.update(posMenuItems).set(patch).where(eq(posMenuItems.id, id));
        return { ok: true, id, created: false };
      }
      const { id: _omit, ...insertVals } = input;
      const [result] = await ctx.db.insert(posMenuItems).values(insertVals);
      const insertId = (result as any).insertId ?? (result as any)[0]?.insertId;
      return { ok: true, id: Number(insertId), created: true };
    }),

  setSoldOut: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
      isSoldOut: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(posMenuItems)
        .where(eq(posMenuItems.id, input.id)).limit(1);
      if (!existing || existing.restaurantId !== input.restaurantId || existing.deletedAt) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.update(posMenuItems)
        .set({ isSoldOut: input.isSoldOut })
        .where(eq(posMenuItems.id, input.id));
      return { ok: true, isSoldOut: input.isSoldOut };
    }),

  deleteItem: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(posMenuItems)
        .where(eq(posMenuItems.id, input.id)).limit(1);
      if (!existing || existing.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.update(posMenuItems)
        .set({ deletedAt: new Date() })
        .where(eq(posMenuItems.id, input.id));
      return { ok: true };
    }),

  // ─── 옵션 그룹 (API만, UI는 2차) ─────────────────────────────
  listOptionGroups: posStoreReadProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      menuItemId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      // 메뉴 매장 일치 검증
      const [item] = await ctx.db.select().from(posMenuItems)
        .where(eq(posMenuItems.id, input.menuItemId)).limit(1);
      if (!item || item.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const groups = await ctx.db.select().from(posMenuOptionGroups)
        .where(eq(posMenuOptionGroups.menuItemId, input.menuItemId))
        .orderBy(posMenuOptionGroups.displayOrder, posMenuOptionGroups.id);
      // 각 그룹의 옵션 일괄 조회
      const groupIds = groups.map(g => g.id);
      const options = groupIds.length === 0 ? [] :
        await ctx.db.select().from(posMenuOptions)
          .where(sql`${posMenuOptions.optionGroupId} IN (${sql.join(groupIds.map(id => sql`${id}`), sql`, `)})`)
          .orderBy(posMenuOptions.displayOrder, posMenuOptions.id);
      return groups.map(g => ({
        ...g,
        options: options.filter(o => o.optionGroupId === g.id),
      }));
    }),

  upsertOptionGroup: posStoreManagerProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      restaurantId: z.number().int().positive(),
      menuItemId: z.number().int().positive(),
      name: z.string().min(1).max(100),
      minSelect: z.number().int().min(0).default(0),
      maxSelect: z.number().int().min(1).default(1),
      isRequired: z.boolean().default(false),
      displayOrder: z.number().int().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      // 메뉴 매장 일치 검증
      const [item] = await ctx.db.select().from(posMenuItems)
        .where(eq(posMenuItems.id, input.menuItemId)).limit(1);
      if (!item || item.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "메뉴가 이 매장과 일치하지 않습니다." });
      }
      if (input.minSelect > input.maxSelect) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "minSelect > maxSelect" });
      }
      if (input.id) {
        const [existing] = await ctx.db.select().from(posMenuOptionGroups)
          .where(eq(posMenuOptionGroups.id, input.id)).limit(1);
        if (!existing || existing.menuItemId !== input.menuItemId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const { id, restaurantId, ...patch } = input;
        await ctx.db.update(posMenuOptionGroups).set(patch).where(eq(posMenuOptionGroups.id, id));
        return { ok: true, id, created: false };
      }
      const { id: _omit, restaurantId: _omit2, ...insertVals } = input;
      const [result] = await ctx.db.insert(posMenuOptionGroups).values(insertVals);
      const insertId = (result as any).insertId ?? (result as any)[0]?.insertId;
      return { ok: true, id: Number(insertId), created: true };
    }),

  deleteOptionGroup: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 그룹의 옵션도 함께 hard delete (이력 무관, 옵션은 스냅샷이 주문라인에 있음)
      const [group] = await ctx.db.select({
        id: posMenuOptionGroups.id,
        menuItemId: posMenuOptionGroups.menuItemId,
      }).from(posMenuOptionGroups).where(eq(posMenuOptionGroups.id, input.id)).limit(1);
      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // 그룹의 메뉴가 본 매장 소속인지 검증
      const [item] = await ctx.db.select({ restaurantId: posMenuItems.restaurantId })
        .from(posMenuItems).where(eq(posMenuItems.id, group.menuItemId)).limit(1);
      if (!item || item.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // 트랜잭션: 옵션 → 그룹 순 삭제
      await ctx.db.transaction(async (tx) => {
        await tx.delete(posMenuOptions).where(eq(posMenuOptions.optionGroupId, input.id));
        await tx.delete(posMenuOptionGroups).where(eq(posMenuOptionGroups.id, input.id));
      });
      return { ok: true };
    }),

  upsertOption: posStoreManagerProcedure
    .input(z.object({
      id: z.number().int().positive().optional(),
      restaurantId: z.number().int().positive(),
      optionGroupId: z.number().int().positive(),
      name: z.string().min(1).max(100),
      priceDelta: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default("0"),
      displayOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // 옵션 그룹 → 메뉴 → 매장 일치 검증
      const [group] = await ctx.db.select({
        menuItemId: posMenuOptionGroups.menuItemId,
      }).from(posMenuOptionGroups).where(eq(posMenuOptionGroups.id, input.optionGroupId)).limit(1);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      const [item] = await ctx.db.select({ restaurantId: posMenuItems.restaurantId })
        .from(posMenuItems).where(eq(posMenuItems.id, group.menuItemId)).limit(1);
      if (!item || item.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "옵션 그룹이 이 매장과 일치하지 않습니다." });
      }
      if (input.id) {
        const [existing] = await ctx.db.select().from(posMenuOptions)
          .where(eq(posMenuOptions.id, input.id)).limit(1);
        if (!existing || existing.optionGroupId !== input.optionGroupId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const { id, restaurantId, ...patch } = input;
        await ctx.db.update(posMenuOptions).set(patch).where(eq(posMenuOptions.id, id));
        return { ok: true, id, created: false };
      }
      const { id: _omit, restaurantId: _omit2, ...insertVals } = input;
      const [result] = await ctx.db.insert(posMenuOptions).values(insertVals);
      const insertId = (result as any).insertId ?? (result as any)[0]?.insertId;
      return { ok: true, id: Number(insertId), created: true };
    }),

  deleteOption: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 옵션 → 그룹 → 메뉴 → 매장 일치 검증
      const [opt] = await ctx.db.select({
        id: posMenuOptions.id,
        optionGroupId: posMenuOptions.optionGroupId,
      }).from(posMenuOptions).where(eq(posMenuOptions.id, input.id)).limit(1);
      if (!opt) throw new TRPCError({ code: "NOT_FOUND" });
      const [group] = await ctx.db.select({ menuItemId: posMenuOptionGroups.menuItemId })
        .from(posMenuOptionGroups).where(eq(posMenuOptionGroups.id, opt.optionGroupId)).limit(1);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      const [item] = await ctx.db.select({ restaurantId: posMenuItems.restaurantId })
        .from(posMenuItems).where(eq(posMenuItems.id, group.menuItemId)).limit(1);
      if (!item || item.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.delete(posMenuOptions).where(eq(posMenuOptions.id, input.id));
      return { ok: true };
    }),
});
```

---

## 3. 검증 절차

### 3.1 빌드
- `pnpm run build` 통과

### 3.2 천호점 prod 시연 (master 또는 owner 계정)

```js
const RID = <천호점_id>;

// 0) 활성 매장 사전 확인 (이전 PR로 enabled 상태)
console.log('0)', await trpc('pos.settings.getStatus', {restaurantId: RID}));

// 1) 카테고리 생성
const c1 = await trpc('pos.menu.upsertCategory', {
  restaurantId: RID, name: '음료', displayOrder: 1
}, 'mutation');
console.log('1)', c1);
const CAT_ID = c1.body[0].result.data.id;

// 2) 카테고리 조회
console.log('2)', await trpc('pos.menu.listCategories', {restaurantId: RID}));

// 3) 메뉴 생성
const m1 = await trpc('pos.menu.upsertItem', {
  restaurantId: RID, categoryId: CAT_ID,
  name: '아메리카노', price: '4500', taxType: 'taxable', displayOrder: 1
}, 'mutation');
console.log('3)', m1);
const ITEM_ID = m1.body[0].result.data.id;

// 4) 메뉴 조회
console.log('4)', await trpc('pos.menu.listItems', {restaurantId: RID}));

// 5) 품절 토글
console.log('5)', await trpc('pos.menu.setSoldOut', {restaurantId: RID, id: ITEM_ID, isSoldOut: true}, 'mutation'));

// 6) 옵션 그룹 + 옵션
const og = await trpc('pos.menu.upsertOptionGroup', {
  restaurantId: RID, menuItemId: ITEM_ID, name: '사이즈',
  minSelect: 1, maxSelect: 1, isRequired: true, displayOrder: 1
}, 'mutation');
console.log('6)', og);
const OG_ID = og.body[0].result.data.id;
console.log('7)', await trpc('pos.menu.upsertOption', {
  restaurantId: RID, optionGroupId: OG_ID, name: 'Tall', priceDelta: '0', displayOrder: 1
}, 'mutation'));
console.log('8)', await trpc('pos.menu.upsertOption', {
  restaurantId: RID, optionGroupId: OG_ID, name: 'Grande', priceDelta: '500', displayOrder: 2
}, 'mutation'));

// 9) 옵션 그룹+옵션 조회
console.log('9)', await trpc('pos.menu.listOptionGroups', {restaurantId: RID, menuItemId: ITEM_ID}));

// 10) 메뉴 soft delete
console.log('10)', await trpc('pos.menu.deleteItem', {restaurantId: RID, id: ITEM_ID}, 'mutation'));

// 11) 카테고리 삭제 (이미 메뉴 soft delete 됐으니 통과)
console.log('11)', await trpc('pos.menu.deleteCategory', {restaurantId: RID, id: CAT_ID}, 'mutation'));
```

### 3.3 활성화 게이트 검증
- 비활성 매장(천호점 외, `posEnabled=false`)에서 `pos.menu.listCategories` 호출 → `FORBIDDEN: POS가 이 매장에 활성화되지 않았습니다`

---

## 4. 5항 보고 템플릿

```
1. 변경 파일:
   - server/routers/pos.ts (menu 라우터 본문 ~300 lines + import 보강)
2. 의도: POS Phase 1 본문 #2 — 메뉴/카테고리/옵션 CRUD 본문 + 활성화 게이트 적용
3. 영향 범위:
   - tRPC: pos.menu.* 11개 endpoint 본문 동작
   - 권한: posStoreReadProcedure (조회), posStoreManagerProcedure (mutation)
   - DB: 변경 없음 (스키마는 38969df에서 이미 존재)
   - UI: 변경 없음
4. 리스크:
   - mysql2 insertId 추출 패턴이 driver 응답 형식에 의존 → Code 표준 패턴 일치 확인
   - 옵션 그룹 deleteOptionGroup은 hard delete (옵션 스냅샷이 주문라인에 있어 무관)
   - 카테고리 deleteCategory는 활성 메뉴 있으면 거부 (FAILED_PRECONDITION)
   - 비활성 매장 호출 시 FORBIDDEN — 의도된 게이트
5. 빌드: pnpm run build ✅
```

---

## 5. 후속 PR 가이드

- 본 PR 통과 → **Order 본문 #3** (`pos.order.create`/`get`/`list` + 트랜잭션·멱등성·채번)
- Order는 본문이 가장 복잡(트랜잭션·`pos_order_counters` 원자 증분·`idempotencyKey` UUID). 별도 패치 문서 필요
- Menu 본문 통과 후 `docs/pos-p1-order-patch.md` 작성
