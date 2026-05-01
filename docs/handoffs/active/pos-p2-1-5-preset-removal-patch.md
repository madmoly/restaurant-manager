# POS P2.1.5 — 프리셋 폐기 + 키오스크/테이블오더 토글 추가

> 작성: 2026-04-30 (Cowork)
> 대상: Claude Code 세션
> 선행 PR: 0013751 (P2.1 한글 라벨 + 라디오 카드)
> 단계: P2.1.5 — 매장 설정 단순화 + boolean 2개 추가. P2.2(메뉴 관리) 진입 전.

---

## 0. 결정값 확정 (사용자 승인)

| Q | 결정 |
|---|---|
| Q-R-1 stylePreset 컬럼 | 보존, UI에서만 사용 안 함 (마이그레이션 X) |
| Q-R-2 applyPreset endpoint | 그대로 두고 클라에서 호출 안 함 (코드 deprecated 주석) |
| Q-R-3 후불+셀프픽업 조합 | UI에서 비활성화 (선택 불가) |
| Q-R-4 천호점 마이그레이션 | 4축 그대로, posStylePreset 보존 (UI에서 무시) |
| Q-R-5 kiosk 디바이스 등록 검증 | `posKioskEnabled=false` 매장에 kiosk 등록 거부 |

---

## 1. 목적·범위

매장 스타일 프리셋 5종(`DEPT_PICKUP` 등) UI에서 폐기. 운영자가 4축을 직접 설정. 키오스크·테이블오더 사용 여부 매장 단위 boolean 2개 추가.

**범위**
- 스키마: `restaurants` 컬럼 2개 추가 (idempotent)
- 서버 라우터: `pos.settings.{enable, override, getStatus}` + `pos.device.create` 4개 endpoint 수정
- 클라이언트: PosToggleCard / PosSettingsCard / posLabels.ts 재작성

**Out of Scope**
- `posStylePreset` 컬럼 drop (보존)
- `pos.settings.applyPreset` 폐기 (deprecated 주석만)
- 손님용 테이블 디바이스 enum 추가 (P3+ 검토)

**완료 조건**
- `pnpm run build` 통과
- prod에 두 컬럼 추가 (자동 마이그레이션)
- master 활성화 → 매장에 4축이 null 상태로 시작
- 운영자가 PosSettingsCard 편집 폼에서 6개 필드(주문시점/테이블서빙/결제/주방/허용오차/키오스크/테이블오더) 입력
- 후불 + 셀프픽업 조합 UI 차단
- 키오스크 디바이스 등록 시 `posKioskEnabled` 검증

---

## 2. 스키마 변경

### 2.1 `drizzle/schema.ts` 수정

기존 `restaurants` 정의에 컬럼 2개 추가:

```ts
posKioskEnabled: boolean("posKioskEnabled").default(false).notNull(),
posTableOrderEnabled: boolean("posTableOrderEnabled").default(false).notNull(),
```

기존 6개 컬럼(`posEnabled`, `posStylePreset`, `posDefaultOrderMode`, `posPaymentProvider`, `posKitchenRouter`, `posReconcileTolerance`) 그대로 보존.

### 2.2 `server/index.ts` 자동 마이그레이션 추가

기존 자동 마이그레이션 블록(restaurants 6컬럼 ALTER 영역)에 idempotent 추가:

```ts
await conn.query(`
  ALTER TABLE restaurants
    ADD COLUMN IF NOT EXISTS posKioskEnabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS posTableOrderEnabled BOOLEAN NOT NULL DEFAULT FALSE
`).catch(() => {});
```

기존 매장은 default false. 천호점 포함 모든 매장이 비활성 상태로 시작 — 운영자가 PosSettingsCard에서 활성화.

---

## 3. 서버 라우터 수정 (`server/routers/pos.ts`)

### 3.1 `pos.settings.enable` — stylePreset 인자 제거

```ts
enable: masterProcedure
  .input(z.object({
    restaurantId: z.number().int().positive(),
    // stylePreset 인자 제거. 4축은 운영자가 override로 직접 설정.
  }))
  .mutation(async ({ ctx, input }) => {
    const [target] = await ctx.db.select().from(restaurants)
      .where(eq(restaurants.id, input.restaurantId)).limit(1);
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
    if (target.posEnabled) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "이미 POS가 활성화된 매장입니다.",
      });
    }
    await ctx.db.update(restaurants)
      .set({ posEnabled: true })
      .where(eq(restaurants.id, input.restaurantId));

    await ctx.db.insert(auditLogs).values({
      userId: ctx.user.id,
      action: "pos.settings.enable",
      target: "restaurant",
      details: JSON.stringify({ restaurantId: input.restaurantId }),
    }).catch(() => {});

    return { ok: true, restaurantId: input.restaurantId };
  }),
```

기존 PRESET_DEFAULTS 주입 로직 제거. 4축은 모두 null로 시작 — UI에서 운영자가 입력.

### 3.2 `pos.settings.applyPreset` — deprecated 주석만

본문 그대로 두되 상단에 주석:

```ts
// @deprecated 2026-04-30 — 프리셋 5종 폐기. pos.settings.override 사용.
// 호환성 위해 본문 유지. 신규 클라이언트는 호출하지 않음.
applyPreset: posStoreOwnerProcedure
  .input(...) // 그대로
  .mutation(...) // 그대로
```

### 3.3 `pos.settings.override` — 2개 필드 추가

```ts
override: posStoreOwnerProcedure
  .input(z.object({
    restaurantId: z.number().int().positive(),
    posDefaultOrderMode: z.enum(["prepaid_pickup", "prepaid_table", "postpaid_table"]).optional(),
    posPaymentProvider: z.enum(["external_dept_store", "terminal_bridge", "van_direct", "manual"]).optional(),
    posKitchenRouter: z.enum(["kds", "printer", "none"]).optional(),
    posReconcileTolerance: z.number().int().min(0).optional(),
    posKioskEnabled: z.boolean().optional(),         // 신규
    posTableOrderEnabled: z.boolean().optional(),    // 신규
  }))
  .mutation(async ({ ctx, input }) => {
    const { restaurantId, ...patch } = input;
    const fields = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    if (Object.keys(fields).length === 0) return { ok: true, noop: true };
    await ctx.db.update(restaurants).set(fields).where(eq(restaurants.id, restaurantId));
    await ctx.db.insert(auditLogs).values({
      userId: ctx.user.id,
      action: "pos.settings.override",
      target: "restaurant",
      details: JSON.stringify({ restaurantId, fields }),
    }).catch(() => {});
    return { ok: true, applied: fields };
  }),
```

### 3.4 `pos.settings.getStatus` — 응답에 2개 필드 추가

```ts
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
      posKioskEnabled: restaurants.posKioskEnabled,         // 신규
      posTableOrderEnabled: restaurants.posTableOrderEnabled, // 신규
    }).from(restaurants).where(eq(restaurants.id, input.restaurantId)).limit(1);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "매장을 찾을 수 없습니다." });
    return r;
  }),
```

### 3.5 `pos.device.create` — kiosk 등록 검증 추가

```ts
create: posStoreOwnerProcedure
  .input(z.object({
    restaurantId: z.number().int().positive(),
    name: z.string().min(1).max(100),
    deviceType: z.enum(["staff_counter", "staff_table", "kiosk", "kds"]),
  }))
  .mutation(async ({ ctx, input }) => {
    cleanupExpiredPairingCodes();

    // kiosk 등록 시 매장의 posKioskEnabled 검증
    if (input.deviceType === "kiosk") {
      const [r] = await ctx.db.select({
        posKioskEnabled: restaurants.posKioskEnabled,
      }).from(restaurants).where(eq(restaurants.id, input.restaurantId)).limit(1);
      if (!r?.posKioskEnabled) {
        throw new TRPCError({
          code: "FAILED_PRECONDITION",
          message: "이 매장은 키오스크 사용이 비활성화되어 있습니다. POS 설정에서 키오스크 사용을 활성화한 후 등록하세요.",
        });
      }
    }

    // 기존 페어링 코드 발급·INSERT 로직 그대로
    ...
  })
```

---

## 4. 클라이언트 수정

### 4.1 `client/src/lib/posLabels.ts` 재작성

기존 `STYLE_PRESET_LABEL`, `STYLE_PRESET_SHORT`는 **제거**. 다음 추가:

```ts
// 주문 시점
export const ORDER_TIMING_LABEL: Record<string, string> = {
  prepaid:  "선불",
  postpaid: "후불",
};

// 테이블 서빙 여부
export const SERVES_AT_TABLE_LABEL: Record<string, string> = {
  true:  "테이블 서빙",
  false: "셀프픽업",
};

// 기존 헬퍼 유지: ORDER_MODE_LABEL, PAYMENT_PROVIDER_LABEL, KITCHEN_ROUTER_LABEL, DEVICE_TYPE_LABEL, TAX_TYPE_LABEL, labelOf

// orderMode 분해/합성 헬퍼
export function decomposeOrderMode(
  mode: string | null | undefined
): { timing: "prepaid" | "postpaid" | null; servesAtTable: boolean | null } {
  switch (mode) {
    case "prepaid_pickup": return { timing: "prepaid", servesAtTable: false };
    case "prepaid_table":  return { timing: "prepaid", servesAtTable: true };
    case "postpaid_table": return { timing: "postpaid", servesAtTable: true };
    default:               return { timing: null, servesAtTable: null };
  }
}

export function composeOrderMode(
  timing: "prepaid" | "postpaid",
  servesAtTable: boolean
): "prepaid_pickup" | "prepaid_table" | "postpaid_table" {
  if (timing === "prepaid"  && !servesAtTable) return "prepaid_pickup";
  if (timing === "prepaid"  &&  servesAtTable) return "prepaid_table";
  if (timing === "postpaid" &&  servesAtTable) return "postpaid_table";
  throw new Error("후불 + 셀프픽업 조합은 지원되지 않습니다.");
}
```

### 4.2 `PosToggleCard.tsx` 단순화

활성화 다이얼로그에서 **프리셋 라디오 카드 제거**. "활성화" 단일 버튼.

```tsx
// 활성화 다이얼로그
<Dialog open={!!enableTarget} onOpenChange={(o) => !o && setEnableTarget(null)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>POS 활성화 — {enableTarget?.name}</DialogTitle>
    </DialogHeader>
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        활성화 후 매장 점장이 POS 설정 화면에서 주문 시점·결제·주방 등을 직접 구성합니다.
      </p>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setEnableTarget(null)}>취소</Button>
      <Button
        disabled={enableMutation.isPending}
        onClick={() => {
          if (!enableTarget) return;
          enableMutation.mutate(
            { restaurantId: enableTarget.id }, // stylePreset 제거
            { onSuccess: () => setEnableTarget(null) }
          );
        }}
      >
        활성화 적용
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

활성 매장 배지: `활성 · STYLE_PRESET_SHORT[...]` → 단순 `활성`만:

```tsx
<Badge variant="default">활성</Badge>
```

**posLabels에서 STYLE_PRESET_SHORT import 제거**.

### 4.3 `PosSettingsCard.tsx` 재작성

표시 dl을 6축으로:

```tsx
const decomposed = decomposeOrderMode(data?.posDefaultOrderMode);

<dl className="text-sm grid grid-cols-2 gap-y-1">
  <dt className="text-muted-foreground">주문 시점</dt>
  <dd>{labelOf(ORDER_TIMING_LABEL, decomposed.timing)}</dd>
  <dt className="text-muted-foreground">테이블 서빙</dt>
  <dd>{decomposed.servesAtTable === null ? "-" : (decomposed.servesAtTable ? "테이블 서빙" : "셀프픽업")}</dd>
  <dt className="text-muted-foreground">결제 처리</dt>
  <dd>{labelOf(PAYMENT_PROVIDER_LABEL, data?.posPaymentProvider)}</dd>
  <dt className="text-muted-foreground">주방 라우터</dt>
  <dd>{labelOf(KITCHEN_ROUTER_LABEL, data?.posKitchenRouter)}</dd>
  <dt className="text-muted-foreground">키오스크 사용</dt>
  <dd>{data?.posKioskEnabled ? "예" : "아니오"}</dd>
  <dt className="text-muted-foreground">테이블 주문 사용</dt>
  <dd>{data?.posTableOrderEnabled ? "예" : "아니오"}</dd>
  <dt className="text-muted-foreground">대조 허용 오차</dt>
  <dd>{(data?.posReconcileTolerance ?? 0).toLocaleString()}원</dd>
</dl>
```

배지에서 `posStylePreset` 표시 제거 (단순 "활성" 배지만).

**버튼 통합**: "프리셋 변경" 폐기. "POS 설정 편집" 단일 버튼.

```tsx
{canEdit && (
  <div className="flex gap-2 pt-2">
    <Button size="sm" variant="outline" onClick={() => openEditDialog()}>
      POS 설정 편집
    </Button>
  </div>
)}
```

**편집 다이얼로그** (단일, 7개 필드):

```tsx
<Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
  <DialogContent className="max-w-md">
    <DialogHeader><DialogTitle>POS 설정 편집</DialogTitle></DialogHeader>
    <div className="space-y-4">
      {/* 주문 시점 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">주문 시점</div>
        <div className="grid grid-cols-2 gap-2">
          {(["prepaid","postpaid"] as const).map(t => (
            <label key={t} className={`flex items-center p-2 border rounded cursor-pointer ${form.timing === t ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
              <input type="radio" name="timing" checked={form.timing === t} onChange={() => setForm(f => ({...f, timing: t, ...(t === 'postpaid' && !f.servesAtTable ? { servesAtTable: true } : {}) }))} className="mr-2"/>
              {ORDER_TIMING_LABEL[t]}
            </label>
          ))}
        </div>
      </div>

      {/* 테이블 서빙 */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 p-2 border rounded">
          <input
            type="checkbox"
            checked={form.servesAtTable}
            disabled={form.timing === "postpaid"}  // 후불은 항상 테이블 (후불+셀프픽업 차단)
            onChange={(e) => setForm(f => ({...f, servesAtTable: e.target.checked}))}
          />
          테이블 서빙 (직원이 자리로 가져다줌)
          {form.timing === "postpaid" && <span className="text-xs text-muted-foreground">(후불은 테이블 필수)</span>}
        </label>
      </div>

      {/* 결제 처리 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">결제 처리</div>
        <div className="grid grid-cols-1 gap-1">
          {(Object.keys(PAYMENT_PROVIDER_LABEL) as const).map(v => (
            <label key={v} className={`flex items-center p-2 border rounded cursor-pointer ${form.paymentProvider === v ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
              <input type="radio" name="paymentProvider" checked={form.paymentProvider === v} onChange={() => setForm(f => ({...f, paymentProvider: v}))} className="mr-2"/>
              {PAYMENT_PROVIDER_LABEL[v]}
            </label>
          ))}
        </div>
      </div>

      {/* 주방 라우터 */}
      <div className="space-y-2">
        <div className="text-sm font-medium">주방 전달</div>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(KITCHEN_ROUTER_LABEL) as const).map(v => (
            <label key={v} className={`flex items-center p-2 border rounded cursor-pointer ${form.kitchenRouter === v ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
              <input type="radio" name="kitchenRouter" checked={form.kitchenRouter === v} onChange={() => setForm(f => ({...f, kitchenRouter: v}))} className="mr-2"/>
              {KITCHEN_ROUTER_LABEL[v]}
            </label>
          ))}
        </div>
      </div>

      {/* 키오스크 / 테이블오더 */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 p-2 border rounded">
          <input type="checkbox" checked={form.kioskEnabled} onChange={(e) => setForm(f => ({...f, kioskEnabled: e.target.checked}))} />
          키오스크 사용
        </label>
        <label className="flex items-center gap-2 p-2 border rounded">
          <input type="checkbox" checked={form.tableOrderEnabled} onChange={(e) => setForm(f => ({...f, tableOrderEnabled: e.target.checked}))} />
          테이블 주문 사용 (손님이 테이블에서 직접 주문)
        </label>
      </div>

      {/* 대조 허용 오차 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">대조 허용 오차 (원)</label>
        <Input type="number" min={0} value={form.tolerance} onChange={(e) => setForm(f => ({...f, tolerance: e.target.value}))}/>
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setEditDialogOpen(false)}>취소</Button>
      <Button disabled={overrideMutation.isPending} onClick={handleSave}>저장</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

`handleSave`:
```ts
const handleSave = () => {
  // 후불 + 셀프픽업 차단 (UI에서 disabled로 막혀있지만 안전장치)
  if (form.timing === "postpaid" && !form.servesAtTable) {
    toast.error("후불은 테이블 서빙만 가능합니다.");
    return;
  }
  const orderMode = composeOrderMode(form.timing, form.servesAtTable);
  const tolerance = parseInt(form.tolerance, 10);
  if (Number.isNaN(tolerance) || tolerance < 0) {
    toast.error("대조 허용 오차가 올바르지 않습니다.");
    return;
  }
  overrideMutation.mutate({
    restaurantId,
    posDefaultOrderMode: orderMode,
    posPaymentProvider: form.paymentProvider,
    posKitchenRouter: form.kitchenRouter,
    posReconcileTolerance: tolerance,
    posKioskEnabled: form.kioskEnabled,
    posTableOrderEnabled: form.tableOrderEnabled,
  }, { onSuccess: () => setEditDialogOpen(false) });
};
```

폼 초기화: 다이얼로그 열릴 때 현재 `data`에서 분해하여 form state 채움.

```ts
const openEditDialog = () => {
  const decomposed = decomposeOrderMode(data?.posDefaultOrderMode);
  setForm({
    timing: decomposed.timing ?? "prepaid",
    servesAtTable: decomposed.servesAtTable ?? false,
    paymentProvider: data?.posPaymentProvider ?? "external_dept_store",
    kitchenRouter: data?.posKitchenRouter ?? "kds",
    kioskEnabled: data?.posKioskEnabled ?? false,
    tableOrderEnabled: data?.posTableOrderEnabled ?? false,
    tolerance: String(data?.posReconcileTolerance ?? 0),
  });
  setEditDialogOpen(true);
};
```

**기존 `applyPreset` mutation 호출 제거**. PresetDialog 제거.

---

## 5. 검증 절차

### 5.1 빌드
- `pnpm run build` 통과
- `npx tsc --noEmit | grep -i 'pos/PosToggle\|pos/PosSettings\|posLabels'` → 0 errors

### 5.2 prod 시연 (배포 후)

**스키마 마이그레이션 검증** (사용자 fetch):
```js
fetch('/api/trpc/pos.settings.getStatus?batch=1&input=' +
  encodeURIComponent(JSON.stringify({"0":{restaurantId:2}})))
  .then(r=>r.json()).then(j=>console.log(JSON.stringify(j[0]?.result?.data, null, 2)));
// 기대: posKioskEnabled: false, posTableOrderEnabled: false 필드 응답에 포함
```

**UI 시연** (master로 /system, 점장으로 /store-info):
1. master /system → 비활성 매장 "활성화" 클릭 → 다이얼로그에 라디오 카드 없음, "활성화 적용" 버튼만
2. 점장 /store-info → POS 설정 카드: dl에 6축 + 허용오차 + 키오스크/테이블오더 표시
3. "POS 설정 편집" 클릭 → 단일 다이얼로그에 7개 필드
4. "후불" 선택 시 테이블 서빙 자동 체크 + disabled
5. 저장 → 응답 정상, 화면 갱신
6. 다시 편집 → 필드 보존 확인

**키오스크 게이트**:
```js
// 천호점 posKioskEnabled=false (디폴트) 상태에서 kiosk 등록 시도
fetch('/api/trpc/pos.device.create?batch=1', {
  method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({"0":{restaurantId:2, name:'테스트', deviceType:'kiosk'}})
}).then(r=>r.json()).then(j=>console.log(j));
// 기대: FAILED_PRECONDITION "이 매장은 키오스크 사용이 비활성화되어 있습니다..."

// 그 후 PosSettingsCard 편집에서 키오스크 사용 체크 → 저장 → 다시 등록 시도
// 기대: 정상 등록
```

---

## 6. 5항 보고 템플릿

```
1. 변경 파일:
   - drizzle/schema.ts (restaurants 컬럼 2개 추가)
   - server/index.ts (자동 마이그레이션 ALTER 추가)
   - server/routers/pos.ts (settings.enable / override / getStatus / device.create 4곳 수정, applyPreset deprecated 주석)
   - client/src/lib/posLabels.ts (STYLE_PRESET 제거, ORDER_TIMING/SERVES_AT_TABLE 추가, decompose/composeOrderMode 헬퍼)
   - client/src/components/pos/PosToggleCard.tsx (활성화 다이얼로그 단순화, 배지 단순화)
   - client/src/components/pos/PosSettingsCard.tsx (편집 폼 통합, 6축 표시)
2. 의도: P2.1.5 — 5종 프리셋 폐기, 4축 직접 설정 + 키오스크/테이블오더 매장 단위 boolean 추가.
3. 영향 범위:
   - DB: restaurants 컬럼 2개 추가 (default false, 기존 매장 영향 0)
   - tRPC: enable 시그니처 변경(stylePreset 제거), override/getStatus 필드 2개 추가, device.create 키오스크 검증
   - UI: PosToggleCard / PosSettingsCard 재작성, posLabels 정리
   - 권한·라우팅·다른 라우터: 무영향
4. 리스크:
   - applyPreset 호출 클라 제거 — 기존 호출처 없으므로 무영향
   - 천호점 기존 4축(prepaid_pickup/external_dept_store/kds/5000) 보존, 새 컬럼 default false → UI에서 자연 노출
   - 후불+셀프픽업 차단 — UI disabled + handleSave 검증 이중 안전장치
   - posStylePreset 컬럼 보존 → 미래 마이그레이션 가능
5. 빌드: pnpm run build ✅
```

---

## 7. 메모

- **호환성**: 기존 master 시연 흐름과 점장 시연 흐름 모두 그대로 동작 (활성화 → 편집)
- **라벨 일관성**: 모든 노출 텍스트 한글 (memory: feedback_korean_user_facing)
- **디바이스 게이트**: P2.4 디바이스 관리 화면 진입 시점에 kiosk/staff_table 추가 검증 더 정교화 가능 (P2.1.5는 서버 거부만)
- **rollback**: 라우터 revert + 컬럼은 보존 (default false라 무해)
