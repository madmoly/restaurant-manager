# POS P1 본문 #1 — `pos.settings.*` + 활성화 게이트 패치

> 작성: 2026-04-19 (Cowork)
> 대상: Claude Code 세션
> 선행 PR: 38969df (Phase 1 골격)
> 선행 문서: `docs/pos-plan.md` v0.5, `docs/pos-p1-handoff.md`
> 단계: P1 본문 채우기 — settings 라우터 + 활성화 게이트 procedure

---

## 0. 목적·범위

마스터(개발자)만 매장별 POS를 켜고 끌 수 있게 권한 게이트를 신설하고, settings 라우터 본문을 채운다.

**범위**
- `server/trpc.ts` — `posStore*Procedure` 4종 신설 (storeXxx에 `posEnabled` 검증 합성)
- `server/routers/pos.ts` settings 라우터:
  - `enable` (master): 시그니처 변경 — `restaurantId, stylePreset?`
  - `disable` (master): 신규
  - `applyPreset` (storeOwner): 신규
  - `override` (storeOwner): 기존
  - `getStatus` (storeRead): 신규
- 기존 다른 라우터(menu/order/payment/reconciliation/device)는 **본 PR에서는 procedure 교체 안 함**. 본문 채우는 후속 PR마다 1:1 교체. 이유: 활성화 게이트 적용 매장이 천호점 1개뿐 → 미활성 상태에서 호출되면 오히려 `FORBIDDEN` 폭주. 게이트 교체는 본문 작성과 동시에.

**완료 조건**
- `pnpm run build` 통과
- `pos.settings.getStatus` 호출 시 천호점 현 상태 정상 반환
- master로 `pos.settings.enable(천호점, 'DEPT_PICKUP')` 호출 → `posEnabled=true` + 4축 디폴트 주입 확인
- 비-master로 `enable` 호출 → `UNAUTHORIZED`/`FORBIDDEN`
- 활성화된 매장에서 owner로 `applyPreset` 호출 성공
- `disable` 시 미완료 주문 있으면 거부

---

## 1. `server/trpc.ts` — `posStore*Procedure` 4종 신설

기존 `storeReadProcedure / storeWriteProcedure / storeManagerProcedure / storeOwnerProcedure`(38969df 신설분)에 `posEnabled` 검증을 합성한다. ctx에 이미 `restaurantId`가 머지되어 있는 표준 패턴을 따르므로, `.use(...)` 미들웨어 한 줄 추가.

```ts
// 기존 import + 신규
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { restaurants } from "../drizzle/schema";

// 활성화 게이트 미들웨어
// 표준 storeXxxProcedure 통과 후 ctx.restaurantId가 정해진 상태에서 호출됨.
// (만약 표준 패턴이 input.restaurantId로 접근한다면 그쪽으로 교체 — Code 세션에서 일관 적용)
const requirePosEnabled = t.middleware(async ({ ctx, next, input }) => {
  // 표준 패턴에 맞춰 restaurantId 획득
  const restaurantId =
    (ctx as any).restaurantId ??
    (input as any)?.restaurantId;
  if (!restaurantId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "posStore*Procedure 사용 시 restaurantId가 필요합니다 (표준 패턴 누락).",
    });
  }
  const rows = await ctx.db
    .select({ posEnabled: restaurants.posEnabled })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!rows[0]?.posEnabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "POS가 이 매장에 활성화되지 않았습니다. 마스터 관리자에게 요청하세요.",
    });
  }
  return next();
});

// 4종 합성 export
export const posStoreReadProcedure = storeReadProcedure.use(requirePosEnabled);
export const posStoreWriteProcedure = storeWriteProcedure.use(requirePosEnabled);
export const posStoreManagerProcedure = storeManagerProcedure.use(requirePosEnabled);
export const posStoreOwnerProcedure = storeOwnerProcedure.use(requirePosEnabled);
```

**주의**:
- `ctx.db` 가 표준 패턴에서 어디서 주입되는지 Code 세션이 확인. (`server/db.ts`의 단일 인스턴스 import도 가능)
- `t.middleware` 가 Code 세션이 만든 표준 trpc 헬퍼와 동일 인스턴스인지 확인. 안 그러면 `router/procedure` 와 같은 `t` 사용
- `input` 접근 시 zod 통과 전이라 unknown. `(input as any)?.restaurantId` 안전 캐스팅 사용

---

## 2. `server/routers/pos.ts` — settings 라우터 본문

### 2.1 PRESET_DEFAULTS 상수 (파일 상단)

```ts
type StylePreset = "DEPT_PICKUP" | "SHOP_PICKUP" | "SHOP_TABLE" | "COURT_PICKUP" | "KIOSK_PICKUP";

const PRESET_DEFAULTS: Record<StylePreset, {
  posDefaultOrderMode: "prepaid_pickup" | "prepaid_table" | "postpaid_table";
  posPaymentProvider: "external_dept_store" | "terminal_bridge" | "van_direct" | "manual";
  posKitchenRouter: "kds" | "printer" | "none";
  posReconcileTolerance: number;
}> = {
  DEPT_PICKUP:  { posDefaultOrderMode: "prepaid_pickup", posPaymentProvider: "external_dept_store", posKitchenRouter: "kds",     posReconcileTolerance: 5000 },
  SHOP_PICKUP:  { posDefaultOrderMode: "prepaid_pickup", posPaymentProvider: "terminal_bridge",     posKitchenRouter: "kds",     posReconcileTolerance: 2000 },
  SHOP_TABLE:   { posDefaultOrderMode: "postpaid_table", posPaymentProvider: "terminal_bridge",     posKitchenRouter: "printer", posReconcileTolerance: 2000 },
  COURT_PICKUP: { posDefaultOrderMode: "prepaid_table",  posPaymentProvider: "terminal_bridge",     posKitchenRouter: "kds",     posReconcileTolerance: 3000 },
  KIOSK_PICKUP: { posDefaultOrderMode: "prepaid_pickup", posPaymentProvider: "terminal_bridge",     posKitchenRouter: "kds",     posReconcileTolerance: 2000 },
};
```

### 2.2 settings 라우터 (전체 교체)

```ts
import { masterProcedure, storeReadProcedure } from "../trpc";
import { posStoreOwnerProcedure } from "../trpc";  // §1에서 신설
import { restaurants, posOrders, auditLogs } from "../../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";

const stylePresetEnum = z.enum([
  "DEPT_PICKUP", "SHOP_PICKUP", "SHOP_TABLE", "COURT_PICKUP", "KIOSK_PICKUP",
]);

const settingsRouter = router({
  // 1) 활성화 (master 전용)
  enable: masterProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      stylePreset: stylePresetEnum.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db.select().from(restaurants)
        .where(eq(restaurants.id, input.restaurantId)).limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
      }
      if (target.posEnabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "이미 POS가 활성화된 매장입니다. 변경하려면 applyPreset/override를 사용하세요.",
        });
      }
      const patch: Record<string, any> = { posEnabled: true };
      if (input.stylePreset) {
        patch.posStylePreset = input.stylePreset;
        Object.assign(patch, PRESET_DEFAULTS[input.stylePreset]);
      }
      await ctx.db.update(restaurants).set(patch).where(eq(restaurants.id, input.restaurantId));

      // 감사 기록 (audit_logs 스키마는 기존 컨벤션 따름. 컬럼명 다르면 Code가 조정)
      await ctx.db.insert(auditLogs).values({
        actorUserId: ctx.user.id,
        action: "pos.settings.enable",
        targetType: "restaurant",
        targetId: input.restaurantId,
        meta: JSON.stringify({ stylePreset: input.stylePreset ?? null }),
      }).catch(() => {});

      return { ok: true, restaurantId: input.restaurantId, stylePreset: input.stylePreset ?? null };
    }),

  // 2) 비활성화 (master 전용, 미완료 주문 있으면 거부)
  disable: masterProcedure
    .input(z.object({ restaurantId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db.select().from(restaurants)
        .where(eq(restaurants.id, input.restaurantId)).limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
      }
      if (!target.posEnabled) {
        return { ok: true, alreadyDisabled: true };
      }

      // 미완료 주문 카운트
      const openOrders = await ctx.db.select({ id: posOrders.id })
        .from(posOrders)
        .where(and(
          eq(posOrders.restaurantId, input.restaurantId),
          inArray(posOrders.status, ["open", "paid", "ready"]),
        ));
      if (openOrders.length > 0) {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: `미완료 주문이 ${openOrders.length}건 있어 비활성화할 수 없습니다. 모든 주문을 마감(served) 또는 취소 후 다시 시도하세요.`,
        });
      }

      await ctx.db.update(restaurants)
        .set({ posEnabled: false })
        .where(eq(restaurants.id, input.restaurantId));

      await ctx.db.insert(auditLogs).values({
        actorUserId: ctx.user.id,
        action: "pos.settings.disable",
        targetType: "restaurant",
        targetId: input.restaurantId,
        meta: null,
      }).catch(() => {});

      return { ok: true };
    }),

  // 3) 프리셋 적용 (storeOwner, 활성화 게이트)
  applyPreset: posStoreOwnerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      stylePreset: stylePresetEnum,
    }))
    .mutation(async ({ ctx, input }) => {
      const defaults = PRESET_DEFAULTS[input.stylePreset];
      await ctx.db.update(restaurants)
        .set({ posStylePreset: input.stylePreset, ...defaults })
        .where(eq(restaurants.id, input.restaurantId));

      await ctx.db.insert(auditLogs).values({
        actorUserId: ctx.user.id,
        action: "pos.settings.applyPreset",
        targetType: "restaurant",
        targetId: input.restaurantId,
        meta: JSON.stringify({ stylePreset: input.stylePreset, defaults }),
      }).catch(() => {});

      return { ok: true, stylePreset: input.stylePreset, ...defaults };
    }),

  // 4) 부분 미세조정 (storeOwner, 활성화 게이트)
  override: posStoreOwnerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      posDefaultOrderMode: z.enum(["prepaid_pickup", "prepaid_table", "postpaid_table"]).optional(),
      posPaymentProvider: z.enum(["external_dept_store", "terminal_bridge", "van_direct", "manual"]).optional(),
      posKitchenRouter: z.enum(["kds", "printer", "none"]).optional(),
      posReconcileTolerance: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { restaurantId, ...patch } = input;
      const fields = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
      if (Object.keys(fields).length === 0) {
        return { ok: true, noop: true };
      }
      await ctx.db.update(restaurants).set(fields).where(eq(restaurants.id, restaurantId));

      await ctx.db.insert(auditLogs).values({
        actorUserId: ctx.user.id,
        action: "pos.settings.override",
        targetType: "restaurant",
        targetId: restaurantId,
        meta: JSON.stringify(fields),
      }).catch(() => {});

      return { ok: true, applied: fields };
    }),

  // 5) 상태 조회 (storeRead, 게이트 없음 — 활성화 여부 자체 확인용)
  getStatus: storeReadProcedure
    .input(z.object({ restaurantId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const [r] = await ctx.db.select({
        posEnabled: restaurants.posEnabled,
        posStylePreset: restaurants.posStylePreset,
        posDefaultOrderMode: restaurants.posDefaultOrderMode,
        posPaymentProvider: restaurants.posPaymentProvider,
        posKitchenRouter: restaurants.posKitchenRouter,
        posReconcileTolerance: restaurants.posReconcileTolerance,
      }).from(restaurants).where(eq(restaurants.id, input.restaurantId)).limit(1);
      if (!r) {
        throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
      }
      return r;
    }),
});
```

**주의**:
- `auditLogs` 스키마의 정확한 컬럼명은 Code가 `drizzle/schema.ts` 확인 후 일치시킴. `actorUserId`, `action`, `targetType`, `targetId`, `meta`가 없으면 가장 가까운 컬럼 매핑 또는 `.catch(() => {})`로 graceful 실패 (감사는 부수 효과, 본 액션 차단하지 않음)
- `ctx.user.id` 접근 — Code 세션 표준 ctx 패턴 따름. 다르면 일관 교체

---

## 3. 스모크 검증 절차

배포 후 (READ-ONLY DB SELECT + tRPC 호출):

1. `pos.settings.getStatus({ restaurantId: <천호점> })` — `posEnabled: false` 기대 (아직 enable 전)
2. master 계정으로 `pos.settings.enable({ restaurantId: <천호점>, stylePreset: 'DEPT_PICKUP' })` 호출
   - 응답: `{ ok: true, restaurantId, stylePreset: 'DEPT_PICKUP' }`
3. `pos.settings.getStatus` 재호출 — `posEnabled: true`, `posStylePreset: 'DEPT_PICKUP'`, 4축 디폴트 채워짐 확인
4. owner(점장) 계정으로 `pos.settings.applyPreset({ restaurantId, stylePreset: 'DEPT_PICKUP' })` 호출 — 성공
5. owner 계정으로 `pos.settings.override({ restaurantId, posReconcileTolerance: 7000 })` 호출 — 성공, `posReconcileTolerance: 7000`
6. master로 `enable` 재호출 — `BAD_REQUEST: 이미 POS가 활성화된 매장입니다`
7. master로 `disable` 호출 — 미완료 주문 0건이면 성공
8. 비-master(예: admin)로 `enable` 호출 — `UNAUTHORIZED` 또는 `FORBIDDEN`

---

## 4. 배포 전 5항 보고 템플릿

```
1. 변경 파일:
   - server/trpc.ts (+~25 lines, posStore*Procedure 4종 신설)
   - server/routers/pos.ts (settings 라우터 본문 작성, ~150 lines)
2. 의도: POS Phase 1 본문 #1 — 마스터 활성화 게이트 + settings 라우터 본문 채움.
3. 영향 범위:
   - 권한: posStore*Procedure 4종 추가, 기존 procedure 영향 없음
   - tRPC: pos.settings.{enable, disable, applyPreset, override, getStatus} 본문 동작
   - 다른 POS 라우터: 본 PR에서 미교체 (후속 PR에서 본문과 함께)
   - DB: 변경 없음
   - UI: 변경 없음
4. 리스크:
   - audit_logs 컬럼 매핑 — 실제 컬럼과 다르면 .catch()로 graceful 실패 (액션 차단 X)
   - 활성화 게이트 합성이 storeXxxProcedure 통과 후 ctx.restaurantId 또는 input.restaurantId 둘 중 하나에 의존 — 표준 패턴 일치 확인 필요
5. 빌드: pnpm run build ✅
```

---

## 5. 후속 PR 가이드 (이번 PR에 포함 안 함)

본문 채우기 도메인별 분할:

1. **이번 PR**: `pos.settings.*` + `posStore*Procedure` 신설
2. 다음 PR: `pos.menu.*` 본문 + 라우터 procedure를 `posStore*` 로 교체
3. 다음 PR: `pos.order.*` 본문 + procedure 교체 (트랜잭션·멱등성·채번 포함)
4. 다음 PR: `pos.payment.*` 본문 + procedure 교체
5. 다음 PR: `pos.reconciliation.*` 본문 + procedure 교체
6. 다음 PR: `pos.device.*` 본문 + procedure 교체

각 PR에서 **본문 작성 + procedure 교체를 동시에** 수행. 그래야 미활성 매장 호출 시 의미 있는 `FORBIDDEN` 응답 (게이트 통과 못 함).

---

## 6. 메모

- `enable`은 멱등 아님 (이미 enabled면 거부). 의도된 보수성. 마스터가 명시적으로 `disable` → `enable` 흐름.
- `applyPreset`은 멱등 (덮어씀). override 값이 있어도 프리셋이 4축을 모두 재주입.
- `override`로 미세조정한 매장에 `applyPreset`을 다시 호출하면 override가 사라진다는 점을 UI에서 경고 권장 (P2).
- `disable`로 비활성화된 매장의 기존 주문·메뉴 데이터는 그대로 보존. `enable` 재호출 시 그대로 사용 가능.
