# 매입 품목 검색형 드롭다운(Combobox) 설계서

> 작성: 2026-04-04 | 상태: Claude Code 전달 대기

## 배경

OCR 품목 자동매칭 로직(findItemCandidates)의 버그가 수정되었으나,
근본적으로 **매칭 임계값(score ≥ 0.7)을 통과하지 못하는 품목은 사용자가 직접 타이핑해야 하는** 문제가 있다.
현재 품목명 Input은 단순 텍스트 필드로, 기존 등록 품목 목록에서 선택하는 수단이 없다.

## 목표

품목명 입력 필드를 **거래처 선택과 동일한 패턴의 검색형 드롭다운**으로 교체하여,
OCR 결과 신뢰도와 무관하게 **항상** 기존 품목 목록에서 선택할 수 있게 한다.

## 현재 구조 (AS-IS)

### 기존 UI 요소 3가지 (분리됨)
1. **빠른 품목 추가** (L1917-1934): 거래처 선택 시 상단에 칩 버튼으로 `cpItems` 전체 나열 → 클릭하면 새 행 추가
2. **품명 Input** (L1964-1969): 단순 텍스트. OCR 프리필 or 수동 타이핑
3. **"혹시:" 칩** (L1992-2016): OCR score 0.3~0.7일 때만 표시. 자동매칭(≥0.7) 시 숨김

### 문제점
- 3개 UI가 분리되어 있어 사용자 학습비용 높음
- 자동매칭이 오매칭이면 수정 수단이 수동 타이핑뿐
- 빠른 품목 추가는 "새 행 추가"만 가능, 기존 행의 품목을 변경하는 용도로 사용 불가
- OCR 없이 수동 입력할 때도 기존 품목을 검색/선택할 방법 없음

## 변경 설계 (TO-BE)

### 핵심: 품명 Input → 검색형 Combobox 교체

기존 `<Input placeholder="품명">` (L1964) 을 거래처 선택 UI(L1803-1853)와 동일한 패턴의 Combobox로 교체.

### 상태별 동작

#### A. 거래처가 선택된 상태 (counterpartyId 있음)
1. Combobox에 OCR 텍스트(또는 빈 값) 프리필
2. **포커스/탭 시** → 드롭다운 열림:
   - **상단 영역**: 해당 거래처 품목(`cpItems`) — `supplierItemName` + 마지막 단가 표시
   - **하단 영역** (구분선): 마스터 품목(`items`) — 거래처 품목에 없는 것만
   - OCR `itemCandidates`가 있으면 해당 품목에 "추천" 뱃지 표시
3. **타이핑 시** → 실시간 필터 (supplierItemName/name 기준 includes 매칭)
4. **품목 선택 시** →
   - `rawItemName` = 선택한 품목명
   - `matchedItemId` = 선택한 품목 ID
   - `counterpartyItemId` = 거래처 품목이면 해당 ID
   - `unitName` = 해당 품목의 `purchaseUnit` (비어있으면 기존값 유지)
   - `unitPrice` = **OCR 단가가 이미 있으면 유지**, 없으면 `lastPrice` || `defaultPrice`
   - 드롭다운 닫힘
5. **목록에 없는 텍스트 입력 후 blur/엔터** → rawItemName 그대로 유지 (새 품목)

#### B. 거래처 미선택 상태
1. 마스터 품목(`items`)만 드롭다운에 표시
2. 나머지 동작은 A와 동일

#### C. OCR 결과 반영
1. 자동매칭(score ≥ 0.7): Combobox에 매칭된 품목명 표시 + 매칭 아이콘(✓)
   - **단, 드롭다운 접근 가능** → 오매칭 시 다른 품목으로 변경 가능
2. 후보만 있음(score 0.3~0.7): Combobox에 OCR 원본 텍스트 + 드롭다운 내 후보에 "추천" 뱃지
3. 매칭 없음: Combobox에 OCR 원본 텍스트, 드롭다운은 전체 목록

### 제거되는 UI
- **"혹시:" 칩 UI** (L1992-2016) → Combobox 드롭다운의 "추천" 뱃지로 흡수
- **"빠른 품목 추가" 칩 영역** (L1917-1934) → 제거. 이 기능은 Combobox가 완전 대체
  - 기존에 "빠른 품목 추가"로 새 행을 추가하던 유스케이스:
    → 빈 행 추가(+ 버튼) 후 Combobox에서 품목 선택으로 대체
  - 데이터 로드(`cpItemsQuery`)는 그대로 유지 (Combobox 목록 데이터로 사용)

### 유지되는 UI
- **자동매칭 표시** (L1986-1989): "✓ 자동매칭 (전표: ...)" → 유지하되 텍스트 수정
  - AS-IS: `✓ 자동매칭 (전표: {원본명})`
  - TO-BE: `전표 원본: {originalName}` (녹색 대신 muted, 참고 정보로 격하)
- **원본명 표시** (L1982-1983): 유지
- **규격 Input** (L1971-1980): 유지 (Combobox 옆 배치)

## 모바일 터치 UX 고려사항

이 앱은 PWA로 모바일에서 주로 사용됨. 식당 현장에서 터치로 조작.

### 드롭다운 크기/위치
- `max-h-48` (192px) 유지 — 거래처 드롭다운과 동일
- 모바일에서 키보드 올라오면 뷰포트 축소됨 → `absolute z-20` 포지셔닝 유지
- 각 옵션 `py-2 px-3` 터치 타겟 최소 44px 확보

### 포커스/블러 처리
- 거래처 UI와 동일 패턴: `onFocus → 열림`, `onBlur → setTimeout 200ms → 닫힘`
- setTimeout 200ms는 옵션 클릭 이벤트가 먼저 발생할 시간 확보용

### 스크롤 성능
- 거래처 품목 수가 30개 이하인 매장이 대부분 → 가상화 불필요
- 마스터 품목이 100개 이상이면 → 필터링 후 상위 20개만 표시 + "더보기" 또는 타이핑 유도

### 키보드 입력 vs 선택
- 모바일에서 타이핑 시작하면 드롭다운 필터링
- 한글 조합 중(composing) 드롭다운 갱신 → debounce 불필요 (목록이 작으므로)
- 선택 없이 blur → rawItemName 그대로 유지 (새 품목 허용)

## 데이터 흐름

### 이미 사용 가능한 데이터
```
cpItems = cpItemsQuery.data  // 거래처 품목 (counterpartyItems.listByCounterparty)
  → { id, itemId, supplierItemName, purchaseUnit, lastPrice, defaultPrice, itemName }
```

### 추가 필요: 마스터 품목 조회
```
allItems = items.list({ restaurantId })
  → { id, name, baseUnit }
```
- `items.list` API가 있는지 확인 필요. 없으면 추가.
- 거래처 품목과 중복 제거: `cpItems`의 `itemId`에 해당하는 마스터 품목은 하단 영역에서 제외

## 단가 프리필 규칙

| 상황 | unitPrice 처리 |
|------|---------------|
| OCR로 단가 추출됨 + 품목 선택 | OCR 단가 유지 (이미 채워져 있으므로) |
| OCR로 단가 추출 안 됨 + 거래처 품목 선택 | `lastPrice` → `defaultPrice` 순으로 프리필 |
| OCR로 단가 추출 안 됨 + 마스터 품목 선택 | 비워둠 (마스터에는 단가 없음) |
| 수동 입력 + 거래처 품목 선택 | `lastPrice` → `defaultPrice` 프리필 |
| 수동 입력 + 마스터 품목 선택 | 비워둠 |

핵심: **OCR 단가가 있으면 절대 덮어쓰지 않는다.** 전표에 적힌 실제 금액이 우선.

## 구현 범위 (Claude Code 작업)

### 1단계: 마스터 품목 API 확인/추가
- `items.list` 또는 유사 API 존재 확인
- 없으면: `items.list` → input: { restaurantId }, output: { id, name, baseUnit }[]
- 완료조건: 클라이언트에서 `trpc.items.list.useQuery({ restaurantId })` 호출 가능

### 2단계: Combobox 구현
- DailyOpsPage.tsx L1960-2016 영역 교체
- 거래처 선택 UI(L1803-1853)와 동일한 패턴 (포커스→드롭다운, 타이핑→필터, blur→닫힘)
- 드롭다운 내용:
  - 거래처 품목 (cpItems): `{supplierItemName} ₩{lastPrice}` 형식
  - 구분선
  - 마스터 품목 (allItems, 중복 제외): `{name}` 형식
  - OCR 추천 뱃지: itemCandidates에 포함된 품목에 "추천" 라벨
- 선택 시: rawItemName, matchedItemId, counterpartyItemId, unitName, unitPrice 업데이트
- 완료조건: 품명 필드 탭 시 드롭다운 열림 + 품목 선택 가능

### 3단계: 기존 UI 정리
- "빠른 품목 추가" 칩 영역(L1917-1934) 제거
- "혹시:" 칩 UI(L1992-2016) 제거
- 자동매칭 표시(L1986-1989) 텍스트 변경: `전표 원본: {originalName}`
- 완료조건: 중복 UI 없음, 단일 진입점(Combobox)으로 통합

### 4단계: 검증
- OCR 분석 후 품목 Combobox에 OCR 텍스트 프리필 확인
- 자동매칭된 품목도 드롭다운으로 변경 가능 확인
- 거래처 변경 시 드롭다운 목록 갱신 확인
- 거래처 미선택 시 마스터 품목만 표시 확인
- 수동 입력(빈 행 추가 → 품목 선택) 플로우 확인
- 단가 프리필 규칙 (OCR 단가 보존, 선택 시 lastPrice 적용) 확인

## 영향 범위

| 파일 | 변경 |
|------|------|
| client/src/pages/DailyOpsPage.tsx | Combobox 구현, 기존 UI 제거 |
| server/routers/items.ts | items.list API 확인/추가 (필요 시) |

서버 OCR 로직(ocr.ts)은 변경 없음. itemCandidates 반환은 그대로 유지하되 클라이언트가 활용 방식만 변경.
