# 레시피 원가 계산 기획서 (recipe-costing)

> 작성: 2026-06-15 (Cowork) · 상태: 설계 확정, Code 구현 대기

---

## 0. 목적

레시피 입력 시 재료를 매입재료(`items`)와 매칭하여 **메뉴별 원가 / 원가율**을 자동 산출한다.
구매단위(예: 배추 1망)와 실사용단위(g)가 다른 문제를 기준단위 환산으로 해결하고, 손질 손실(가식부율)·조리 폐기(로스율)를 원가에 반영한다.

## 1. 확정 결정사항

| 항목 | 결정 | 비고 |
|---|---|---|
| 단위 환산 정밀도 | **A. 가식부율 분리** | 생물 총무게(conversionToBase) ↔ 실사용(yieldRate) 분리 추적 |
| 단가 출처 | **비싼 거 기준 (MAX)** | 거래처별 g당 단가 중 최대값. 보수적(원가 과대) — §11 리스크 참조 |
| 원가 계산 시점 | **동적(조회 시 현재 단가)** | 스냅샷 미적용. 레시피에 원가 저장 안 함 |
| 기존 레시피 | **무시, 신규 작성분부터 적용** | content 파싱 마이그레이션 안 함 |

## 2. 데이터 모델

### 2-1. 신규 테이블 `recipe_ingredients` (재료행)

```
recipe_ingredients
  id            int PK auto
  restaurantId  int NOT NULL
  recipeId      int NOT NULL          → recipes.id
  itemId        int NULL              → items.id (매칭된 매입재료)
  rawName       varchar(100) NULL     → 미매칭 재료 텍스트 (점진 매칭용)
  quantity      decimal(10,4) NOT NULL → 기준단위 실사용량 (손질 후 들어가는 양)
  unitName      varchar(30) NULL      → 표시용 (g/ml/ea)
  yieldRate     decimal(5,4) DEFAULT 1.0000 → 가식부율 (0<r≤1)
  sortOrder     int DEFAULT 0
  note          text NULL
  createdAt     timestamp
```

- `quantity` 정의 = **손질 후 실제 들어가는 양**. 생물 사용량은 `quantity / yieldRate`로 역산.
- `itemId` NULL + `rawName`만 있으면 미매칭 상태 → 원가 계산에서 제외 + UI에서 매칭 유도.

### 2-2. `recipes` 컬럼 추가

```
servingYield  decimal(10,2) DEFAULT 1  → 1배치 산출 인분 (1이면 1인분 레시피)
sellingPrice  decimal(14,2) NULL       → 판매가 (원가율 계산용)
lossRate      decimal(5,4) DEFAULT 0   → 메뉴 단위 폐기 로스율
```

### 2-3. `items` 컬럼 추가 (단가 수동 override — escape hatch)

```
costPerBaseManual decimal(14,4) NULL  → 설정 시 자동 MAX 단가보다 우선
```

### 2-4. 재활용 (변경 없음)

- `items.baseUnit` — 기준단위(g/ml/ea)
- `counterpartyItems.conversionToBase` — 구매단위→기준단위 환산계수 (배추 1망 → 6000g)
- `counterpartyItems.lastPrice` / `defaultPrice` — 구매단위당 가격
- `counterpartyItems.isActive` — 비활성 거래처 단가 제외
- `restaurants.targetCostRatio` — 목표 원가율 경고 기준

## 3. 단가 환산 로직 (g당 가격)

```
거래처별 g당단가 = effectivePrice / conversionToBase
  effectivePrice = COALESCE(lastPrice, defaultPrice)
  단, conversionToBase IS NULL OR = 0  → 해당 거래처 제외(환산 불가)

item g당단가(pricePerBase):
  IF items.costPerBaseManual IS NOT NULL → costPerBaseManual (수동 우선)
  ELSE → MAX(거래처별 g당단가) over isActive=true 거래처   ← "비싼 거 기준"
  IF 유효 거래처 0개 → NULL (원가 계산 불가)
```

배추 예시: 1망 9,000원 / conversionToBase 6,000g = **1.5원/g**. 가식부율 0.83이면 실사용 g당 실효원가 = 1.5 / 0.83 ≈ 1.81원.

## 4. 원가 산식

```
재료행 원가 = (quantity / yieldRate) × pricePerBase
메뉴 총원가 = Σ(재료행 원가) × (1 + lossRate)
1인분 원가  = 메뉴 총원가 / servingYield
원가율      = 1인분 원가 / sellingPrice         (sellingPrice 있을 때만)
```

- `yieldRate`(가식부율) = 재료별 손질 손실. `lossRate`(로스율) = 메뉴별 조리/보관 폐기. **둘은 별개 층 — 합산 금지(이중계상).**

## 5. 엣지/예외 처리

| 상황 | 처리 |
|---|---|
| pricePerBase NULL (환산 불가) | 재료행 원가 = NULL. 메뉴 "원가 불완전" 표시. **0 처리 금지** |
| yieldRate 0 또는 NULL | 1.0으로 간주 |
| itemId NULL (rawName만) | 미매칭 → 원가 제외 + 매칭 유도 배지 |
| baseUnit ≠ unitName | 정보성 경고 (계산은 진행) |
| sellingPrice NULL | 원가만 표시, 원가율 생략 |
| 원가율 > targetCostRatio | 경고색 표시 |

## 6. UI 요구 (RecipesPage 신규/편집)

- 재료행 추가: item 검색·선택(미존재 시 rawName 자유입력) + 수량 + 단위 + 가식부율(기본 100%)
- 행별 자동 표시: g당단가, 출처 거래처명, 단가 신선도(최근 매입일 기준 경고)
- 합계: 메뉴 총원가 / 1인분 원가 / 원가율, 목표 원가율 초과 경고
- 환산 불가·미매칭 항목 강조

## 7. tRPC 라우터

- `recipes` 라우터 확장 또는 `recipeIngredients` 신설:
  - `listByRecipe(recipeId)`
  - `upsert(recipeId, ingredients[])` — 행 일괄 저장
  - `costPreview(recipeId)` — 동적 원가 계산 결과 반환
- 단가 헬퍼: item별 pricePerBase + 출처 거래처 + 신선도 조회 (서버 계산)
- 접근권한: 조회 전체, 편집 `managerProcedure` 이상 (레시피 편집 기존 정책 준수) + `verifyStoreAccess`

## 8. 마이그레이션 (server/index.ts 자동)

```sql
CREATE TABLE IF NOT EXISTS recipe_ingredients (...);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS servingYield  DECIMAL(10,2) DEFAULT 1;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS sellingPrice  DECIMAL(14,2) DEFAULT NULL;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS lossRate      DECIMAL(5,4)  DEFAULT 0;
ALTER TABLE items   ADD COLUMN IF NOT EXISTS costPerBaseManual DECIMAL(14,4) DEFAULT NULL;
```
(idempotent, `.catch(() => {})` 패턴)

## 9. 구현 단계 (Code 핸드오프)

1. `drizzle/schema.ts` 테이블/컬럼 + `server/index.ts` 자동 마이그레이션 — *완료: build 통과*
2. tRPC 라우터(`recipeIngredients` 또는 recipes 확장) + 단가 헬퍼 + `routers/index.ts` 등록 — *완료: 타입체크 통과*
3. RecipesPage 재료행 UI + 원가 요약 — *완료: 신규 레시피에 재료 매칭·원가 표시*
4. build + Railway 배포 — *완료: §4 5항 보고 후 push*

## 10. 미해결 / 추후

- 단가 영향 리포트(재료 단가 변동 → 영향 메뉴 목록) — 별도 이슈
- conversionToBase 실측 vs 추정 플래그 — 별도 이슈
- 매입 OCR 품목사전(`counterparty_ocr_profiles`) 재활용한 자동 재료매칭 — 별도 이슈

## 11. 리스크

1. **단가 MAX 기준 = 원가 보수적 과대평가.** 실제 마진보다 비관적으로 나옴. 안전마진엔 유리하나, 평균/preferred 전환 옵션을 추후 검토 여지로 남김.
2. **conversionToBase 추정 오차** — 작황·규격으로 ±20% 변동. 도입 시 1회 실측 권장, 분기 재확인.
3. **부가세 혼입 단가**(CLAUDE.md §14) 잔존 — lastPrice 자체 노이즈. 수동 override(`costPerBaseManual`)로 보정 가능.
4. **단위 정의 책임** — baseUnit(g/ml/ea) 일관성은 매장 입력 품질에 의존.
