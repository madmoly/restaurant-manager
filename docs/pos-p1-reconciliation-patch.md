# POS P1 본문 #5 — `pos.reconciliation.*` 본문 (일일 대조)

> 작성: 2026-04-19 (Cowork)
> 대상: Claude Code 세션
> 선행 PR: 3a013b2 (Payment 본문 #4)
> 선행 시연: 10/10 통과 (#3 보류분 markReady/markServed/refund도 통합 검증 완료)
> 선행 문서: `docs/pos-plan.md` v0.5, 본문 #1~#4 패치
> 단계: P1 본문 #5 — 외부 결제 매장(천호점 같은 백화점 입점) 일일 대조

---

## 0. 결정값 확정 (사용자 승인)

- **Q-O5-1 posGross 자동 집계**: `getOrCreate` 호출 시 자동 계산 — 활성 결제(`pos_payments WHERE voidedAt IS NULL`) 중 KST 해당 날짜 amount 합산. cron 불필요. 매장 직원이 일마감 시 즉시 최신값.
- **Q-O5-2 confirm 후 재변경**: confirmed 상태에서 `setExternal` 거부. master만 `unconfirm` 가능 (신규 endpoint).
- **Q-O5-3 임계치 초과**: 경고만 표시, `confirm` 가능. 매장 `posReconcileTolerance` 활용. 사용자 운영 방식("약간 달라도 그냥 넘어감") 일치.

---

## 1. 목적·범위

활성 매장(천호점 같은 외부 결제 매장)의 일일 매출 대조.

**범위 (라우터 5개 endpoint)**
- `pos.reconciliation.getOrCreate` (posStoreRead + 게이트) — 행 없으면 자동 집계 + 생성. 미확정 상태면 posGross/diff 자동 갱신
- `pos.reconciliation.setExternal` (posStoreManager + 게이트) — 백화점 정산 금액 입력, diff 갱신
- `pos.reconciliation.confirm` (posStoreManager + 게이트) — 확정. 임계치 초과 시 경고 반환
- `pos.reconciliation.unconfirm` (masterProcedure) — 마스터만 풀 수 있음 (신규)
- `pos.reconciliation.list` (posStoreRead + 게이트) — 월별 이력 조회 (신규, UI에서 사용)

**완료 조건**
- `pnpm run build` 통과
- 천호점에서 `getOrCreate('YYYY-MM-DD')` 호출 시 그날 활성 결제 합 자동 산출
- `setExternal` 후 diff 정확
- `confirm` 시 임계치(천호점 5000원) 초과 여부 응답에 포함, 확정은 통과
- 확정 후 `setExternal` 거부, `unconfirm` 호출 시 master만 통과
- 비활성 매장 게이트

---

## 2. `server/routers/pos.ts` — reconciliation 라우터 본문 (전체 교체)

### 2.1 헬퍼 추가 (파일 상단, 기존 헬퍼 옆)

```ts
// KST 'YYYY-MM-DD'를 UTC date range [start, end)로 변환
function kstDateRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
```

### 2.2 Import 보강 (대부분 #3/#4에서 이미 추가됨)

```ts
// 추가 필요: posDailyReconciliation, restaurants, masterProcedure
// (이미 있으면 생략)
```

### 2.3 reconciliation 라우터 본문

```ts
const reconciliationRouter = router({
  // ─── 조회/자동생성 + 자동갱신 ───────────────────────────────
  getOrCreate: posStoreReadProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
    }))
    .query(async ({ ctx, input }) => {
      // posGross 자동 집계 — 활성 결제 합산
      const range = kstDateRange(input.date);
      const sums = await ctx.db.select({ amount: posPayments.amount })
        .from(posPayments)
        .innerJoin(posOrders, eq(posOrders.id, posPayments.orderId))
        .where(and(
          eq(posOrders.restaurantId, input.restaurantId),
          isNull(posPayments.voidedAt),
          gte(posPayments.createdAt, range.start),
          lte(posPayments.createdAt, range.end),
        ));
      const posGrossNum = sums.reduce((s, p) => s + Number(p.amount), 0);
      const posGross = posGrossNum.toFixed(2);

      // 기존 행 조회
      const [existing] = await ctx.db.select().from(posDailyReconciliation)
        .where(and(
          eq(posDailyReconciliation.restaurantId, input.restaurantId),
          eq(posDailyReconciliation.date, input.date),
        )).limit(1);

      if (existing) {
        // 미확정 상태면 posGross/diff 자동 갱신, 확정이면 그대로 반환
        if (!existing.confirmedAt) {
          const diff = Number(existing.externalGross) - posGrossNum;
          await ctx.db.update(posDailyReconciliation)
            .set({ posGross, diff: diff.toFixed(2) })
            .where(eq(posDailyReconciliation.id, existing.id));
          return { ...existing, posGross, diff: diff.toFixed(2) };
        }
        return existing;
      }

      // 신규 생성
      const [result] = await ctx.db.insert(posDailyReconciliation).values({
        restaurantId: input.restaurantId,
        date: input.date,
        posGross,
        externalGross: "0",
        diff: (-posGrossNum).toFixed(2),
      });
      const id = Number((result as any).insertId);
      const [created] = await ctx.db.select().from(posDailyReconciliation)
        .where(eq(posDailyReconciliation.id, id)).limit(1);
      return created;
    }),

  // ─── 외부(백화점) 금액 입력 ────────────────────────────────
  setExternal: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      externalGross: z.string().regex(/^\d+(\.\d{1,2})?$/),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(posDailyReconciliation)
        .where(and(
          eq(posDailyReconciliation.restaurantId, input.restaurantId),
          eq(posDailyReconciliation.date, input.date),
        )).limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "대조 행이 없습니다. 먼저 getOrCreate를 호출하세요.",
        });
      }
      if (existing.confirmedAt) {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: "이미 확정된 대조입니다. 마스터에게 unconfirm을 요청하세요.",
        });
      }
      const diff = Number(input.externalGross) - Number(existing.posGross);
      await ctx.db.update(posDailyReconciliation)
        .set({
          externalGross: input.externalGross,
          diff: diff.toFixed(2),
          ...(input.note !== undefined ? { note: input.note } : {}),
        })
        .where(eq(posDailyReconciliation.id, existing.id));
      return { ok: true, diff: diff.toFixed(2) };
    }),

  // ─── 확정 (임계치 초과는 경고만) ───────────────────────────
  confirm: posStoreManagerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(posDailyReconciliation)
        .where(and(
          eq(posDailyReconciliation.restaurantId, input.restaurantId),
          eq(posDailyReconciliation.date, input.date),
        )).limit(1);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "대조 행이 없습니다.",
        });
      }
      if (existing.confirmedAt) {
        return { ok: true, alreadyConfirmed: true };
      }
      // 임계치 조회 + 초과 여부 (경고만)
      const [r] = await ctx.db.select({
        tolerance: restaurants.posReconcileTolerance,
      }).from(restaurants).where(eq(restaurants.id, input.restaurantId)).limit(1);
      const tolerance = r?.tolerance ?? 0;
      const diffAbs = Math.abs(Number(existing.diff));
      const overTolerance = diffAbs > tolerance;

      await ctx.db.update(posDailyReconciliation)
        .set({
          confirmedByUserId: ctx.user.id,
          confirmedAt: new Date(),
        })
        .where(eq(posDailyReconciliation.id, existing.id));

      return {
        ok: true,
        diff: existing.diff,
        tolerance,
        overTolerance,
        warning: overTolerance
          ? `차이(${existing.diff})가 임계치(${tolerance})를 초과했지만 확정되었습니다.`
          : null,
      };
    }),

  // ─── 확정 풀기 (master 전용) ───────────────────────────────
  unconfirm: masterProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(posDailyReconciliation)
        .where(and(
          eq(posDailyReconciliation.restaurantId, input.restaurantId),
          eq(posDailyReconciliation.date, input.date),
        )).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (!existing.confirmedAt) {
        return { ok: true, alreadyUnconfirmed: true };
      }
      await ctx.db.update(posDailyReconciliation)
        .set({ confirmedByUserId: null, confirmedAt: null })
        .where(eq(posDailyReconciliation.id, existing.id));
      return { ok: true };
    }),

  // ─── 월별 이력 조회 ────────────────────────────────────────
  list: posStoreReadProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      limit: z.number().int().min(1).max(200).default(31),
    }))
    .query(async ({ ctx, input }) => {
      const conds = [eq(posDailyReconciliation.restaurantId, input.restaurantId)];
      if (input.from) conds.push(gte(posDailyReconciliation.date, input.from));
      if (input.to) conds.push(lte(posDailyReconciliation.date, input.to));
      return ctx.db.select().from(posDailyReconciliation)
        .where(and(...conds))
        .orderBy(desc(posDailyReconciliation.date))
        .limit(input.limit);
    }),
});
```

**주의**: 기존 `reconciliationRouter` stub 전체 교체. `unconfirm`/`list` 신규 추가 — 골격에 없던 endpoint.

---

## 3. 검증 절차

### 3.1 빌드
- `pnpm run build` 통과

### 3.2 prod 시연 (천호점 id=2, master)

**3.2.1 사전 — 그날 결제 1건 만들기**

```js
const RID = 2;
const c = await trpc('pos.menu.upsertCategory', {restaurantId: RID, name: '음료', displayOrder: 1}, 'mutation');
const CAT_ID = c.body[0].result.data.id;
const m = await trpc('pos.menu.upsertItem', {restaurantId: RID, categoryId: CAT_ID, name: '아메리카노', price: '4500', taxType: 'taxable', displayOrder: 1}, 'mutation');
const ITEM_ID = m.body[0].result.data.id;

const o = await trpc('pos.order.create', {restaurantId: RID, orderMode: 'prepaid_pickup', items: [{ menuItemId: ITEM_ID, qty: 1 }]}, 'mutation');
const O_ID = o.body[0].result.data.id;
await trpc('pos.payment.record', {restaurantId: RID, orderId: O_ID, method: 'card', amount: '4500', providerType: 'external_dept_store'}, 'mutation');
// O_ID 결제 4500 → paid

// 오늘 KST 날짜 (UTC+9)
const TODAY = new Date(Date.now() + 9*60*60*1000).toISOString().slice(0,10);
console.log('TODAY:', TODAY);
```

**3.2.2 본 시연 (총 8단계)**

```js
// 1) getOrCreate — 신규 생성, posGross 자동 집계
console.log('1) getOrCreate:', await trpc('pos.reconciliation.getOrCreate', {restaurantId: RID, date: TODAY}));
// 기대: {posGross: '4500.00' 이상, externalGross: '0', diff: 음수, confirmedAt: null}

// 2) setExternal — 백화점 금액 입력
console.log('2) setExternal:', await trpc('pos.reconciliation.setExternal', {restaurantId: RID, date: TODAY, externalGross: '5000', note: '백화점 리포트 5000'}, 'mutation'));
// 기대: {ok:true, diff:'500.00'} (5000-4500)

// 3) getOrCreate 재호출 — diff 갱신 확인 (posGross 변동 없음)
console.log('3) getOrCreate 재호출:', await trpc('pos.reconciliation.getOrCreate', {restaurantId: RID, date: TODAY}));

// 4) 추가 결제 1건 → posGross 변경
const o2 = await trpc('pos.order.create', {restaurantId: RID, orderMode: 'prepaid_pickup', items: [{ menuItemId: ITEM_ID, qty: 1 }]}, 'mutation');
const O2_ID = o2.body[0].result.data.id;
await trpc('pos.payment.record', {restaurantId: RID, orderId: O2_ID, method: 'card', amount: '4500', providerType: 'external_dept_store'}, 'mutation');
console.log('4) 추가결제 후 getOrCreate:', await trpc('pos.reconciliation.getOrCreate', {restaurantId: RID, date: TODAY}));
// 기대: posGross='9000.00', diff='-4000.00' (5000-9000)

// 5) confirm — 임계치 5000원 초과 (4000원이라 미초과)
console.log('5) confirm (임계치 미초과):', await trpc('pos.reconciliation.confirm', {restaurantId: RID, date: TODAY}, 'mutation'));
// 기대: {ok:true, diff:'-4000.00', tolerance:5000, overTolerance:false, warning:null}

// 6) confirmed 상태에서 setExternal 거부
console.log('6) setExternal after confirm:', await trpc('pos.reconciliation.setExternal', {restaurantId: RID, date: TODAY, externalGross: '6000'}, 'mutation'));
// 기대: FAILED_PRECONDITION: 이미 확정된 대조

// 7) unconfirm (master) → 다시 setExternal 가능
console.log('7) unconfirm:', await trpc('pos.reconciliation.unconfirm', {restaurantId: RID, date: TODAY}, 'mutation'));
const r2 = await trpc('pos.reconciliation.setExternal', {restaurantId: RID, date: TODAY, externalGross: '15000'}, 'mutation');
console.log('7b) setExternal 15000 (임계치 초과 6000):', r2);
const c2 = await trpc('pos.reconciliation.confirm', {restaurantId: RID, date: TODAY}, 'mutation');
console.log('7c) confirm 임계치 초과:', c2);
// 기대: warning에 임계치 초과 메시지 포함, 그래도 확정됨 (overTolerance:true)

// 8) list (월별)
console.log('8) list:', await trpc('pos.reconciliation.list', {restaurantId: RID, from: TODAY.slice(0,8)+'01'}));
// 기대: 1건

// 9) 비활성 매장 게이트
console.log('9) 게이트:', await trpc('pos.reconciliation.getOrCreate', {restaurantId: 4, date: TODAY}));
// 기대: FORBIDDEN

// 정리 (메뉴/카테고리만, 대조 데이터는 보존 — 운영 데이터)
await trpc('pos.menu.deleteItem', {restaurantId: RID, id: ITEM_ID}, 'mutation');
await trpc('pos.menu.deleteCategory', {restaurantId: RID, id: CAT_ID}, 'mutation');
```

### 3.3 기대값 표

| 단계 | 기대 |
|---|---|
| 1) getOrCreate 신규 | `posGross >= 4500.00, externalGross:'0', diff: 음수, confirmedAt: null` |
| 2) setExternal 5000 | `ok:true, diff:'500.00'` (5000-4500) |
| 3) getOrCreate 재호출 | `diff:'500.00'` 그대로 (posGross 변동 없으면) |
| 4) 추가결제 후 | `posGross:'9000.00', diff:'-4000.00'` |
| 5) confirm 미초과 | `tolerance:5000, overTolerance:false, warning:null` |
| 6) confirmed → setExternal | `FAILED_PRECONDITION: 이미 확정된 대조` |
| 7) unconfirm + 임계치 초과 confirm | `overTolerance:true, warning:'차이(...)가 임계치(5000)를 초과했지만 확정되었습니다.'` |
| 8) list | 1건 |
| 9) 게이트 | `FORBIDDEN` |

---

## 4. 5항 보고 템플릿

```
1. 변경 파일:
   - server/routers/pos.ts (reconciliationRouter 본문 5 endpoint + kstDateRange 헬퍼)
2. 의도: POS Phase 1 본문 #5 — 일일 대조. 활성 결제 자동 집계, 외부 입력, 확정/임계치 경고, master unconfirm.
3. 영향 범위:
   - tRPC: pos.reconciliation.{getOrCreate, setExternal, confirm, unconfirm, list} 5개 endpoint
   - 권한: posStoreReadProcedure (조회), posStoreManagerProcedure (변경/확정), masterProcedure (unconfirm)
   - DB: 변경 없음
   - UI: 변경 없음
4. 리스크:
   - posGross 자동 집계: 활성 결제 합산. 환불 음수도 포함되어 자연스럽게 차감. paid 안 된 부분결제도 포함됨 — 의도 (실제 입금 기준)
   - KST date range: 'YYYY-MM-DD'+9 시간대 변환. 일관 패턴
   - confirm 임계치: 경고만, 확정 가능. 사용자 운영 방식 일치
   - unconfirm: master 전용. 마감 무결성
   - 롤백: reconciliation 라우터 본문만, revert 가능
5. 빌드: pnpm run build ✅
```

---

## 5. 후속 PR 가이드

본 PR 통과 → P1 마지막:
- **Device 본문 #6** (`pos.device.*`) — POS 디바이스 등록·페어링·KDS 연동 (가장 가벼움)

#6 끝나면 P1 백엔드 완료, P2 UI 진입.

---

## 6. 메모

- **posGross 정의**: "활성 결제 amount 합". paid 안 된 부분결제도 포함 → "실제 매장에 들어온 돈" 기준. open 상태 주문이라도 부분결제분은 매장 입금이므로 합리적.
- **외부 매장 한정?**: 본 PR은 모든 활성 매장에서 사용 가능. 다만 천호점 같은 외부 결제 매장에서 의미 큼. 로드샵은 internal 결제 = posGross가 곧 정답이라 externalGross 거의 안 씀.
- **타임존**: 서버 UTC 가정. `kstDateRange`는 KST `YYYY-MM-DD`를 UTC range로 변환. order 채번과 일관.
- **floating point**: 합계 비교 없으니 #4 대비 안전 영역.
