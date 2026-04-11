# 매입관리 긴급 수정 — Claude Code 핸드오프

> 작성: 2026-04-11 (Cowork, 프로덕션 확인 후)
> 선행 배포: Phase 0+1 완료 상태
> 성격: 프로덕션 버그 수정 (품목마스터 탭 데이터 누락)

---

## 현상 (프로덕션 스크린샷 확인)

1. **품목마스터 탭: 전 품목이 "거래처 0곳"** — 거래처 매핑이 전혀 표시되지 않음
2. **유사품목 경고 배너 미노출** — "깻잎순"과 "깻잎손" 같은 오타/유사 품목이 감지·표시되지 않음

---

## 원인 분석

### 거래처 0곳 (심각도: 치명)

`items.listWithMappings` 프로시저가 `counterparty_items.itemId = items.id`로 JOIN.
그러나 기존 `counterparty_items` 레코드의 `itemId`가 대부분 **NULL**.

기존 시스템에서 `counterparty_items`는 `supplierItemName` 기반으로 생성/관리되었고,
`itemId` 컬럼은 채워지지 않았다. P0-1 역매핑 스크립트는 `purchase_order_items_v2.itemId`만 다루고,
`counterparty_items.itemId`는 누락.

P1-2(저장 시 counterpartyItem 자동 생성)는 **신규 저장부터만** 적용 → 기존 데이터 여전히 NULL.

### 유사품목 배너 미노출 (심각도: 높음)

품목마스터 탭 재구성(P1-4) 시 `findSimilarGroups` 호출이 누락되었거나,
배너 렌더링 로직이 빠졌을 가능성. 코드 확인 필요.

---

## 수정 작업 (2건)

### HF-1: counterparty_items.itemId 역매핑

**목표**: 기존 `counterparty_items` 레코드에 `itemId`를 채워서 `listWithMappings` JOIN이 작동하게 함.

**작업**:
1. 먼저 현황 확인 쿼리 실행 (READ ONLY):
   ```sql
   -- counterparty_items 중 itemId NULL 비율
   SELECT 
     COUNT(*) AS total,
     SUM(CASE WHEN itemId IS NULL THEN 1 ELSE 0 END) AS null_count,
     ROUND(SUM(CASE WHEN itemId IS NULL THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS null_pct
   FROM counterparty_items;
   ```

2. `scripts/backfill-item-ids.ts` 스크립트 확장 (이미 P0-1용으로 존재):
   - **Phase A**: `counterparty_items` 역매핑 추가
     - `counterparty_items.supplierItemName` → `items.name` fuzzy match
     - score ≥ 0.7 → 자동 UPDATE `counterparty_items.itemId`
     - score < 0.7 → 로그 출력
   - **Phase B**: 기존 P0-1 로직 (`purchase_order_items_v2.itemId` 역매핑) — 이미 작성됨

3. `--dry-run` 모드 지원 필수 (UPDATE 없이 매칭 결과만 출력)
4. 실행 순서: `--dry-run` → 결과 보고 → 승인 → 실행

**관련 파일**: 
- `scripts/backfill-item-ids.ts` (확장)
- `server/ocr.ts` (fuzzyScore, normalizeKorean — 재사용, 변경 없음)
- `drizzle/schema.ts` (counterparty_items 스키마 참조)

**완료 조건**: 
- counterparty_items의 itemId NULL 비율 대폭 감소
- 품목마스터 탭에서 거래처 N곳 (N > 0) 표시되는 품목 존재

**주의**: DB WRITE 작업이므로 `--dry-run` 결과 보고 후 승인 대기.

### HF-2: 유사품목 경고 배너 확인/복구

**목표**: 품목마스터 탭에서 유사품목(Levenshtein 기반) 감지 시 경고 배너 표시.

**작업**:
1. `client/src/pages/PurchaseManagementPage.tsx` — ItemMasterTab 컴포넌트 확인
2. `findSimilarGroups` tRPC 호출이 있는지 확인
   - 없으면: 추가. `trpc.items.findSimilarGroups.useQuery()` 호출
   - 있으면: 배너 렌더링 조건 확인
3. 경고 배너 UI:
   - 상단에 노란색 배너: "유사한 이름의 품목 N건이 감지되었습니다"
   - 클릭 시 유사 그룹 목록 표시 (예: "깻잎순 ↔ 깻잎손")
   - 각 그룹에 [병합] 버튼 — 기존 merge 로직 연결

**관련 파일**:
- `client/src/pages/PurchaseManagementPage.tsx` (ItemMasterTab)
- `server/routers/items.ts` (findSimilarGroups — 기존 프로시저, 변경 불필요할 가능성 높음)

**완료 조건**: "깻잎순"과 "깻잎손" 같은 유사 품목이 배너에 감지·표시됨

---

## 실행 순서

```
1. HF-2 (유사품목 배너) — 코드만, DB 무관 → 바로 진행
2. HF-1 현황 확인 쿼리 (READ ONLY) → 결과 보고
3. HF-1 스크립트 확장 + --dry-run → 결과 보고
4. HF-1 --dry-run 승인 후 실행 (DB WRITE) → 정지 조건
5. pnpm run build 통과 확인
6. git push 전 5항 요약 보고 → 승인 대기
```

## 핵심 파일 맵

| 파일 | 작업 | 변경 종류 |
|---|---|---|
| `scripts/backfill-item-ids.ts` | HF-1 | counterparty_items 역매핑 Phase 추가 |
| `client/src/pages/PurchaseManagementPage.tsx` | HF-2 | findSimilarGroups 호출 + 배너 UI |
| `server/routers/items.ts` | HF-2 | 확인만 (변경 불필요 예상) |
