# 매장 분석 페이지 설계 (store-analysis)

> 작성: 2026-07-02 (Cowork) · 상태: P1~P6 구현·배포 완료(커밋 78311bc~ed7f6c8) · master/manager 브라우저 QA 완료(2026-07-02 Cowork) · F1·F3 수정 완료(2026-07-02 Code, 미push)
>   - QA 통과: master 4축 렌더, 그룹 필터 칩, 매장 멀티셀렉트, 미확정 포함 뱃지, 목표 미설정 뱃지, 이상치 하이라이트(-171.4% 행), 그룹간 비교 테이블, /business 축소+상세분석 링크+유지 섹션 정상, 점장 계정 /store-analysis 리다이렉트+네비 미노출, 콘솔 에러 0
>   - **F1 수정 완료**: 그룹별 모드 추이 차트 데이터 미표시. 원인 — 그룹 집계 시 `confirmed` 판정이 그룹 내 전(全)매장 확정(AND)을 요구해, 매장 1곳만 미확정이어도 해당 월 그룹 포인트 전체가 null 처리되어 사실상 전 구간이 비었음. 매장별 모드는 매장당 confirmed가 독립적이라 증상이 드러나지 않았음. `StoreAnalysisPage.tsx` 그룹/합계(forceCombined) 집계의 confirmed 판정을 AND→OR(매장 1곳이라도 확정이면 유효 포인트)로 변경.
>   - **결함 F2 (UX, 미해결·판단 보류)**: 당월(월초) 지표 왜곡 — 운영 건전성 3지표가 풀월 영업일 분모라 월초엔 전부 0~16%, 고정비 풀월 반영으로 당월 이익률 -422.7%. 당월은 경과 영업일 기준 분모/안분 또는 "월초 왜곡" 안내 필요 — A/B/C안 중 미결정.
>   - **F3 수정 완료**: /business 영업이익률 KPI trend가 "-422.71188208881733%" 미반올림 노출. `AdminDashboard.tsx` StatCard trend value를 `Math.round(profitRate * 10) / 10`로 반올림.
>   - admin QA 통과(2026-07-02): 그룹 필터·매장별/그룹별 토글 미노출 ✅, 스코핑 정상(소유 7매장만, Tutorial/미배정 제외; 당월 이익 -1,846,288원 = master 그룹간 비교의 331컴퍼니 행과 일치) ✅, 4축 렌더 ✅, 12개월 토글 정상(X축 25/8~26/7, 합계 12행, 라인 렌더) ✅
>   - 미검증: 모바일 실기기, 미확정 월 점선/툴팁(현재는 라인 단절로 처리 — spec 3.3①과 상이하나 수용 가능), F1 수정 후 재QA(그룹별 모드 라인 렌더 확인 — push/배포 후 필요)
>   - 잔여 수정 대상: F2(월초 당월 지표 왜곡 — 판단 보류, A/B/C안 결정 대기)
> 대상: master / admin 계정 전용 신규 분석 페이지 + 기존 `/business` 중복 제거

---

## 0. 핵심 판단

- **신설**: `/store-analysis` 라우트. `/business`는 "오늘+이번달 현황판"으로 축소, 분석 기능은 전부 신규 페이지로 이관.
- **분석 4축**: ① 월별 추이(6/12개월) ② 목표 대비 달성률 ③ 매장간 비교/랭킹 ④ 운영 건전성.
- **역할 스코프**: master = 사업그룹 필터 + 그룹간 비교 축 제공. admin = 자기 소유 매장별 축만(그룹 UI 미노출).
- **데이터 전략**: 추이는 `monthly_closings`(월마감 확정치) 우선, 미마감 월은 라이브 집계 폴백. 현재 월은 항상 라이브.

## 1. 가장 큰 문제 (설계 리스크)

1. **성능**: 현행 `admin.multiStoreMonthlySummary`는 매장당 ~5쿼리(일마감 목록·매출·매입·인건비·경비) + 인건비 시프트 재계산. 12개월 × N매장 라이브 집계는 불가 수준. → **월마감 확정치 필수 활용**이 전제. `monthly_closings`에 row가 없는 (매장,월)은 추이 차트에서 "미확정" 처리하고 라이브 재계산하지 않는다(현재 월만 예외).
2. **월마감 이행률 의존**: 월마감을 안 하는 매장은 추이가 비어 보인다. 이는 버그가 아니라 **운영 규율을 드러내는 신호**로 설계에 흡수 — 미확정 월은 회색 표시 + "월마감 미이행" 툴팁. 별도 백필 배치 없음.
3. **목표 필드 미활용 상태**: `restaurants.monthlyTargetSales / targetLaborRatio / targetCostRatio`는 스키마만 있고 실데이터 입력 여부 불명. 목표 미설정 매장(target=0/기본값)은 달성률 축에서 "목표 미설정"으로 명시 표기, 0% 취급 금지.
4. **기존 페이지 제거에 따른 동선 변화**: `/business`의 손익 상세 테이블·매출 비교 차트를 쓰던 사용자가 있다면 이동 경로 안내 필요 → `/business`에 "상세 분석 →" 링크로 대체.

## 2. 기존 `/business` 대조 및 정리

| 현행 `/business` 섹션 | 처리 |
|---|---|
| 전체 매장 금일 현황 (오픈/마감/출근/중간매출) | **유지** (현황판 고유 기능) |
| KPI 카드 4개 (총매출·매입·인건비·이익률) | **유지** (이번달 스냅샷) |
| 영업이익 요약 카드 + 비율 바 | **유지** |
| 사업그룹 필터 (master) | **유지** (현황판에도 유효) |
| 매장별 매출 비교 차트 (BarChart) | **제거** → 신규 페이지 ③축으로 이관 |
| 비용 구성비 파이 차트 | **제거** → 신규 페이지로 이관 (매장/그룹 선택 연동) |
| 매장별 손익 상세 테이블 | **제거** → 신규 페이지 ③축 랭킹 테이블로 대체 |
| 최근 알림 | **유지** |
| (신규) "상세 분석 →" 버튼 | 헤더 우측에 `/store-analysis` 링크 추가 |

제거 후 `/business`는 ~350줄 수준으로 축소 예상. `multiStoreMonthlySummary` 호출은 유지(당월 KPI용), `prevSummary` 호출도 유지(전월 대비).

## 3. 신규 페이지 구조

### 3.1 라우팅/권한
- 경로: `/store-analysis` · 컴포넌트: `client/src/pages/StoreAnalysisPage.tsx`
- 접근: master, admin (App.tsx 두 분기에 라우트 추가)
- 네비: AppLayout "매장 분석" 라벨, `/business` 아래 배치. manager 이하 미노출.

### 3.2 공통 컨트롤 (페이지 상단 고정)
- **기간**: 종료 월 선택(기본 당월) + 범위 토글 `6개월 | 12개월`
- **그룹 필터** (master 전용): 전체 / 그룹별 / Tutorial — 현행 `/business` 칩 UI 재사용
- **매장 멀티셀렉트**: 스코프 내 매장 체크박스(기본 전체). 추이 차트 라인 수 제어용.

### 3.3 섹션 구성 (4축)

**① 월별 추이**
- 라인 차트 2개: (a) 매출 추이 (b) 영업이익률 추이. X=월, 시리즈=매장(또는 master 그룹 모드 시 그룹 합산).
- 미확정 월: 해당 포인트 회색/점선 + 툴팁 "월마감 미이행".
- 하단 미니 테이블: 월별 합계 (매출/매입/인건비/고정비/경비/이익/이익률).

**② 목표 대비 달성률** (선택 월 기준, 기본 당월)
- 매장별 가로 막대: 매출 달성률 = 확정매출 / monthlyTargetSales. 100% 기준선.
- 비율 준수: 인건비율 vs targetLaborRatio, 원가율(매입비율) vs targetCostRatio — 초과 시 적색 뱃지.
- 목표 미설정 매장: "목표 미설정" 라벨 + 매장 설정 딥링크(owner/admin이 입력하도록 유도).

**③ 매장간 비교/랭킹** (선택 월 기준)
- 정렬 가능 테이블: 매출 / 이익 / 이익률 / 인건비율 / 매입비율 / 일마감이행률. 컬럼 헤더 클릭 정렬.
- 이상치 하이라이트: 스코프 내 중앙값 대비 이익률 -10%p 이하 행 적색 배경.
- master 그룹 모드: 그룹 단위 집계 행으로 전환(그룹간 비교).
- 비용 구성비 파이 차트(이관분): 테이블에서 매장 클릭 시 해당 매장 기준으로 갱신.

**④ 운영 건전성** (선택 월 기준)
- 매장별 카드/행: 
  - **일마감 이행률** = closedDays / 영업일수. 영업일수 = 달력일수 − `store_closed_days` − `store_weekly_closures` 해당일.
  - **체크리스트 완료율** = 완료 로그 / (유효 템플릿 수 × 영업일수). `store_checklist_templates`의 effectiveFrom/To 필터 적용.
  - **스케줄 커버리지** = 스케줄 존재 영업일 / 영업일수.
- 3지표 60% 미만 적색, 60~90% 황색, 90%+ 녹색.

### 3.4 모바일
- 차트는 세로 스택, 랭킹 테이블은 카드 리스트로 대체(현행 `/business` 패턴 동일). 추이 차트는 매장 3개 초과 선택 시 모바일에서 합산 라인 1개로 강제.

## 4. API 설계 (신규 라우터 `server/routers/analysis.ts`)

전 프로시저 `adminProcedure`. 스코핑은 `getOwnedRestaurants` 재사용(master=전체+Tutorial, admin=소유분).

### 4.1 `analysis.storeTrends`
```ts
input: { endYear: number, endMonth: number, months: 6 | 12 }
```
- `monthly_closings`에서 스코프 매장 × 기간 IN 조회 **단일 쿼리** (restaurantId IN + (year,month) 범위).
- 현재 월(및 현재 월만): `multiStoreMonthlySummary` 내부 로직 재사용해 라이브 집계. → 집계 로직을 `server/helpers/monthlyAggregate.ts`로 추출해 admin 라우터와 공유 (중복 구현 금지).
- 반환: `{ months: [{ year, month, stores: [{ restaurantId, groupName, salesTotal, purchasesTotal, laborCost, fixedCostTotal, expensesTotal, profit, profitRate, confirmed: boolean }] }] }`
- 예상 쿼리 수: 1 (확정분) + 현재월 라이브 N매장분. 12개월 전체 라이브 재계산 절대 금지.

### 4.2 `analysis.targetAttainment`
```ts
input: { year: number, month: number }
```
- 실적: 해당 월 monthly_closings(확정) 또는 당월이면 라이브.
- 목표: restaurants 3필드. `monthlyTargetSales <= 0`이면 `targetSet: false`.
- 반환: 매장별 `{ salesAttainment, laborRatio, targetLaborRatio, costRatio, targetCostRatio, targetSet }`

### 4.3 `analysis.operationalHealth`
```ts
input: { year: number, month: number }
```
- 영업일수: 달력일수 − store_closed_days − store_weekly_closures 전개. (스코프 매장 일괄, 매장당 쿼리 금지 — IN 조회 후 메모리 계산)
- 일마감: daily_closings COUNT GROUP BY restaurantId (1쿼리)
- 체크리스트: daily_checklist_logs COUNT GROUP BY restaurantId (1쿼리) + 유효 템플릿 수 (1쿼리)
- 스케줄: DISTINCT DATE(startTime) COUNT GROUP BY restaurantId (1쿼리)
- 반환: 매장별 `{ bizDays, closingRate, checklistRate, scheduleCoverage }`

### 4.4 등록
- `server/routers/index.ts`에 `analysis: analysisRouter` 추가.

## 5. 구현 순서 (Code 핸드오프 단계)

| 단계 | 작업 | 완료 조건 |
|---|---|---|
| P1 | `server/helpers/monthlyAggregate.ts` 추출 (admin 라우터 로직 이동, 동작 불변) | `pnpm run build` 통과 + `/business` 수치 기존과 동일 |
| P2 | `analysis` 라우터 3 프로시저 + index 등록 | build 통과 + 수동 curl/브라우저로 3 API 응답 확인 |
| P3 | `StoreAnalysisPage.tsx` — 컨트롤 + ①추이 + ③랭킹 | 라우트 접근·차트 렌더·master 그룹필터 동작 |
| P4 | ②목표 대비 + ④운영 건전성 섹션 | 목표 미설정 표기·건전성 3지표 색상 규칙 동작 |
| P5 | `/business` 중복 섹션 제거 + "상세 분석" 링크 | /business 렌더 정상·제거 항목 신규 페이지에서 커버 확인 |
| P6 | App.tsx/AppLayout 라우팅·네비 + 모바일 검증 | admin/master 노출, manager 이하 미노출 |

P1~P2, P3~P4, P5~P6 각각 별도 커밋. 배포 전 §4 5항 요약 보고(전역 규칙).

## 6. 비고

- 사용자 노출 텍스트 전부 한글(라벨 매핑 헬퍼 경유). API 필드는 영어.
- recharts 이미 번들에 포함 — 신규 차트 라이브러리 추가 금지 (번들 1.5MB 기술부채 §16 고려).
- admin의 SUB대표(parentId) 계층 분해는 **범위 외** (2026-07-02 결정). 필요 시 후속.
- `monthly_closings` 값과 라이브 집계 산식이 다르면 추이에 단차 발생 가능 — 월마감 시점의 저장 값이 SSOT. 단차 발견 시 QA 문서(qa_2026-05-02_월정산_정합성 참조) 절차로 진단.
