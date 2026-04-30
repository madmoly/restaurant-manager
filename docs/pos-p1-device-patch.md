# POS P1 본문 #6 — `pos.device.*` 본문 (디바이스 등록·페어링·토큰)

> 작성: 2026-04-19 (Cowork)
> 대상: Claude Code 세션
> 선행 PR: f8e4596 (Reconciliation #5)
> 선행 시연: 9/9 통과
> 단계: P1 본문 #6 — **P1 백엔드 마지막**. 끝나면 P2 UI 진입.

---

## 0. 결정값 확정 (사용자 승인)

- **Q-O6-1 페어링 코드**: 6자리 숫자, **1회용 + 5분 TTL**
- **Q-O6-2 디바이스 토큰**: raw token은 클라이언트 보관, 서버는 **SHA-256 해시만** `pos_devices.deviceTokenHash`에 저장. 폐기 시 hash=null.
- **Q-O6-3 페어링 코드 저장**: **서버 메모리**(`Map + setTimeout`). 재배포 시 무효화돼도 사용자가 5분 안에 재발급하면 됨.

---

## 1. 목적·범위

POS 디바이스(키오스크·KDS·스태프 단말) 등록·페어링 + 토큰 인증 인프라.

**범위 (라우터 5개 endpoint)**
- `pos.device.list` (posStoreOwner + 게이트) — 디바이스 목록 (hash 미노출)
- `pos.device.create` (posStoreOwner + 게이트) — 등록 + 6자리 페어링 코드 발급
- `pos.device.pair` (publicProcedure) — 페어링 코드 → raw token 발급 (1회용)
- `pos.device.revoke` (posStoreOwner + 게이트) — 토큰 무효화 (hash=null, isActive=false)
- `pos.device.heartbeat` (publicProcedure) — 디바이스 토큰 검증 + lastSeenAt 갱신 (P2 UI에서 KDS 화면이 주기 호출)

**완료 조건**
- `pnpm run build` 통과
- create → 6자리 코드 + 5분 TTL 응답
- pair → raw token 응답, hash DB 저장
- 잘못된 코드 / 만료 코드 → NOT_FOUND
- heartbeat 정상 / revoke 후 UNAUTHORIZED
- 비활성 매장 list 게이트

---

## 2. `server/routers/pos.ts` — device 라우터 본문

### 2.1 Import 보강

```ts
import { createHash } from "node:crypto";
// 이미 import됨: randomUUID, posDevices, publicProcedure, posStoreOwnerProcedure
```

### 2.2 페어링 코드 메모리 캐시 (파일 상단, 라우터 정의 앞)

```ts
// 페어링 코드 메모리 캐시 (5분 TTL, 1회용)
// Railway 재배포 시 무효화 — 사용자가 재발급하면 됨
const pairingCodes = new Map<string, { deviceId: number; restaurantId: number; expiresAt: number }>();

function cleanupExpiredPairingCodes() {
  const now = Date.now();
  for (const [code, info] of pairingCodes) {
    if (info.expiresAt < now) pairingCodes.delete(code);
  }
}

function generatePairingCode(): string {
  // 100000 ~ 999999
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
```

### 2.3 device 라우터 본문 (전체 교체)

```ts
const deviceRouter = router({
  // ─── 목록 (점장 이상) ──────────────────────────────────────
  list: posStoreOwnerProcedure
    .input(z.object({ restaurantId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.select({
        id: posDevices.id,
        name: posDevices.name,
        deviceType: posDevices.deviceType,
        isActive: posDevices.isActive,
        lastSeenAt: posDevices.lastSeenAt,
        createdAt: posDevices.createdAt,
        // hash 자체는 노출 안 함, 페어링 여부만
        deviceTokenHash: posDevices.deviceTokenHash,
      }).from(posDevices)
        .where(eq(posDevices.restaurantId, input.restaurantId))
        .orderBy(desc(posDevices.createdAt));
      return rows.map(r => ({
        ...r,
        deviceTokenHash: undefined,
        hasToken: r.deviceTokenHash !== null,
      }));
    }),

  // ─── 등록 + 페어링 코드 발급 (점장 이상) ────────────────
  create: posStoreOwnerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      name: z.string().min(1).max(100),
      deviceType: z.enum(["staff_counter", "staff_table", "kiosk", "kds"]),
    }))
    .mutation(async ({ ctx, input }) => {
      cleanupExpiredPairingCodes();

      const [result] = await ctx.db.insert(posDevices).values({
        restaurantId: input.restaurantId,
        name: input.name,
        deviceType: input.deviceType,
        isActive: true,
      });
      const deviceId = Number((result as any).insertId);

      // 충돌 회피 (확률 매우 낮지만)
      let code = generatePairingCode();
      let tries = 0;
      while (pairingCodes.has(code) && tries < 20) {
        code = generatePairingCode();
        tries++;
      }
      if (pairingCodes.has(code)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "페어링 코드 충돌. 다시 시도하세요.",
        });
      }

      const expiresAt = Date.now() + 5 * 60 * 1000;
      pairingCodes.set(code, {
        deviceId,
        restaurantId: input.restaurantId,
        expiresAt,
      });

      return {
        ok: true,
        id: deviceId,
        pairingCode: code,
        expiresInSeconds: 300,
      };
    }),

  // ─── 페어링 (디바이스가 직접 호출, 인증 없음) ───────────
  pair: publicProcedure
    .input(z.object({
      pairingCode: z.string().regex(/^\d{6}$/, "6자리 숫자"),
    }))
    .mutation(async ({ ctx, input }) => {
      cleanupExpiredPairingCodes();

      const info = pairingCodes.get(input.pairingCode);
      if (!info) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "페어링 코드가 잘못되었거나 만료되었습니다.",
        });
      }
      pairingCodes.delete(input.pairingCode); // 1회용

      // raw token 생성 (UUID 2개 결합 → 72자, 충돌 사실상 0)
      const rawToken = `${randomUUID()}-${randomUUID()}`;
      const hash = hashToken(rawToken);

      await ctx.db.update(posDevices)
        .set({ deviceTokenHash: hash, lastSeenAt: new Date() })
        .where(eq(posDevices.id, info.deviceId));

      // 디바이스 정보 함께 반환 (디바이스 측 화면 라우팅용)
      const [device] = await ctx.db.select().from(posDevices)
        .where(eq(posDevices.id, info.deviceId)).limit(1);

      return {
        ok: true,
        deviceId: info.deviceId,
        deviceToken: rawToken,
        deviceType: device?.deviceType ?? null,
        restaurantId: info.restaurantId,
      };
    }),

  // ─── 폐기 (점장 이상) ──────────────────────────────────
  revoke: posStoreOwnerProcedure
    .input(z.object({
      restaurantId: z.number().int().positive(),
      id: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db.select().from(posDevices)
        .where(eq(posDevices.id, input.id)).limit(1);
      if (!d || d.restaurantId !== input.restaurantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.update(posDevices)
        .set({ deviceTokenHash: null, isActive: false })
        .where(eq(posDevices.id, input.id));
      return { ok: true };
    }),

  // ─── 디바이스 heartbeat (디바이스가 주기 호출, 인증 = 토큰) ──
  heartbeat: publicProcedure
    .input(z.object({
      deviceToken: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const hash = hashToken(input.deviceToken);
      const [d] = await ctx.db.select().from(posDevices)
        .where(eq(posDevices.deviceTokenHash, hash)).limit(1);
      if (!d || !d.isActive) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "디바이스 토큰이 잘못되었거나 폐기되었습니다.",
        });
      }
      await ctx.db.update(posDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(posDevices.id, d.id));
      return {
        ok: true,
        deviceId: d.id,
        deviceType: d.deviceType,
        restaurantId: d.restaurantId,
        name: d.name,
      };
    }),
});
```

**주의**: 기존 `deviceRouter` stub 전체 교체.

---

## 3. 검증 절차

### 3.1 빌드
- `pnpm run build` 통과

### 3.2 prod 시연 (천호점 id=2, master)

```js
const RID = 2;

// 1) 디바이스 등록 + 페어링 코드 발급
const c1 = await trpc('pos.device.create', {
  restaurantId: RID, name: '천호점-키오스크-1', deviceType: 'kiosk',
}, 'mutation');
console.log('1) create:', c1);
const DEVICE_ID = c1.body[0].result.data.id;
const PAIRING_CODE = c1.body[0].result.data.pairingCode;
// 기대: { ok, id, pairingCode: '6자리', expiresInSeconds: 300 }

// 2) list — hasToken: false
console.log('2) list:', await trpc('pos.device.list', {restaurantId: RID}));
// 기대: 1개 디바이스, hasToken: false, deviceType: 'kiosk'

// 3) 잘못된 코드 pair → NOT_FOUND
console.log('3) wrong code:', await trpc('pos.device.pair', {pairingCode: '000000'}, 'mutation'));
// 기대: NOT_FOUND: 페어링 코드가 잘못되었거나 만료되었습니다

// 4) 정상 pair → raw token
const p1 = await trpc('pos.device.pair', {pairingCode: PAIRING_CODE}, 'mutation');
console.log('4) pair:', p1);
const DEVICE_TOKEN = p1.body[0].result.data.deviceToken;
// 기대: { ok, deviceId, deviceToken: 'uuid-uuid', deviceType: 'kiosk', restaurantId: 2 }

// 5) 같은 코드 재pair → NOT_FOUND (1회용)
console.log('5) re-pair:', await trpc('pos.device.pair', {pairingCode: PAIRING_CODE}, 'mutation'));
// 기대: NOT_FOUND

// 6) list — hasToken: true
console.log('6) list 후:', await trpc('pos.device.list', {restaurantId: RID}));
// 기대: hasToken: true, lastSeenAt: 방금 시간

// 7) heartbeat 정상
console.log('7) heartbeat:', await trpc('pos.device.heartbeat', {deviceToken: DEVICE_TOKEN}, 'mutation'));
// 기대: { ok, deviceId, deviceType: 'kiosk', restaurantId: 2, name: '천호점-키오스크-1' }

// 8) revoke
console.log('8) revoke:', await trpc('pos.device.revoke', {restaurantId: RID, id: DEVICE_ID}, 'mutation'));

// 9) revoke된 토큰 heartbeat → UNAUTHORIZED
console.log('9) heartbeat 후:', await trpc('pos.device.heartbeat', {deviceToken: DEVICE_TOKEN}, 'mutation'));
// 기대: UNAUTHORIZED

// 10) 비활성 매장 게이트 — list 호출
console.log('10) 게이트:', await trpc('pos.device.list', {restaurantId: 4}));
// 기대: FORBIDDEN

// 11) 잘못된 토큰 형식 heartbeat → UNAUTHORIZED
console.log('11) bad token:', await trpc('pos.device.heartbeat', {deviceToken: 'invalid-token-string-zzzzz'}, 'mutation'));
// 기대: UNAUTHORIZED

// 정리 (revoke로 비활성, 데이터 보존)
```

### 3.3 기대값 표

| 단계 | 기대 |
|---|---|
| 1) create | `{ id, pairingCode: 6자리, expiresInSeconds: 300 }` |
| 2) list 전 | 1개 디바이스, `hasToken: false` |
| 3) 잘못된 코드 | `NOT_FOUND` |
| 4) 정상 pair | raw token 응답 (UUID-UUID 형식) |
| 5) 재pair | `NOT_FOUND` (1회용) |
| 6) list 후 | `hasToken: true, lastSeenAt: 최근` |
| 7) heartbeat | 디바이스 정보 응답, lastSeenAt 갱신 |
| 8) revoke | `ok` |
| 9) revoke된 토큰 heartbeat | `UNAUTHORIZED` |
| 10) 게이트 | `FORBIDDEN` |
| 11) 잘못된 토큰 | `UNAUTHORIZED` |

---

## 4. 5항 보고 템플릿

```
1. 변경 파일:
   - server/routers/pos.ts (deviceRouter 본문 5 endpoint + 페어링 캐시 + hashToken 헬퍼)
2. 의도: POS Phase 1 본문 #6 (P1 마지막) — 디바이스 등록·페어링·토큰 인증.
   6자리 1회용 코드 5분 TTL, SHA-256 해시 저장, heartbeat로 lastSeenAt 갱신.
3. 영향 범위:
   - tRPC: pos.device.{list, create, pair, revoke, heartbeat} 5 endpoint
   - 권한: posStoreOwner (list/create/revoke), publicProcedure (pair/heartbeat — 토큰 자체가 인증)
   - 메모리: pairingCodes Map (재배포 시 휘발)
   - DB: 변경 없음
   - UI: 변경 없음
4. 리스크:
   - 페어링 코드 메모리 캐시: 재배포 시 휘발 → 사용자 재발급 필요. 의도된 단순성.
   - 6자리 숫자 brute force: 100만 조합. rate limit 없음 (1차). 5분 안에 brute force 비현실적이지만 다중 매장 확장 시 추가 고려.
   - heartbeat publicProcedure: 토큰만으로 인증. 토큰 자체가 secret이므로 정당.
   - revoke 후 lastSeenAt 보존: 마지막 사용 이력 추적용.
   - 롤백: device 라우터 본문만, revert 가능.
5. 빌드: pnpm run build ✅
```

---

## 5. P1 백엔드 완료 후 다음 단계

**P1 백엔드 완성** → P2 UI 진입:

- 천호점 스태프 카운터 UI (`DEPT_PICKUP` 5화면): 메뉴 → 장바구니 → 결제수단 → 진동벨 → 완료
- KDS 웹 화면 (주방 태블릿용)
- 마스터 시스템 페이지에 "POS 활성화/비활성화" 토글
- 일일 대조 화면 (월정산 페이지 또는 별도)

**Out of P1**: 키오스크 UI / 후불 테이블 UI / 카드단말기 브릿지 / 영수증 출력 — Phase 2~6에서 점진 전개.

---

## 6. 메모

- **rawToken 형식**: `${uuid}-${uuid}` 72자. 충돌 사실상 0. 클라이언트는 cookie + localStorage 둘 다 저장 권장 (cookie 사라져도 localStorage에서 복원).
- **lastSeenAt**: heartbeat 호출 시 갱신. KDS는 30초 간격 호출 권장 (P2 UI에서 결정).
- **isActive=false**: revoke 시 자동. 폐기된 디바이스는 list 응답에 남되 hasToken=false로 표시.
- **페어링 충돌**: 100만 조합에서 5분 TTL이면 사실상 0. 20번 재시도 fallback.
- **재배포 영향**: 페어링 코드 발급 후 재배포 → 코드 무효화. 사용자 재발급 필요. 운영상 거의 무관 (5분 TTL).
