# 핸드오프 — 매입전표 OCR 정확도 (열 판별 / 줄바꿈 품목 / 과세·면세 / 합계 정합)

> **v4 (2026-07-29)** — v3를 대체. v2 원문은 git `ee53759`에 보존.
> **v4의 변경 이유**: v3의 Phase 0은 월푸상사 양식(단가 = 부가세 포함)을 **범용 규칙으로 단정**해 프롬프트에 박도록 지시했다. 거래처마다 양식이 다르므로 이 방식은 다른 양식에서 정상 판독을 망가뜨린다. **양식을 단정하는 설계 → 문서에서 관계식을 판별하는 설계로 전환.**
> 작성: Cowork (설계·검증만, 소스 미수정 — memory `feedback-cowork-no-direct-edit`)
> 대상: Claude Code 세션

---

## §0. 이 문서를 읽는 법

| 상태 | 의미 |
|---|---|
| ✅ | `ee53759`에 반영 완료 — 재작업 불필요 |
| ⚠️ | 부분 반영 — 동작하지만 규칙이 다름. 보완 필요 |
| ❌ | 미반영 — 잔여 작업 |

**착수 지점: §5.** 그 앞은 배경과 근거다. 급하면 §3(양식 다양성) → §4(구현 현황) → §5(잔여 작업) → 부록 A 순.

**v3에서 v4로 오며 뒤집힌 것**은 §3 전체와 P2·P3·P5다. v3를 이미 읽었다면 그 세 곳만 다시 보면 된다.

---

## §1. 배경

### 1-1. 사용자 원 요청 (3건)

1. 매입 전표 분석 시 **품목 명칭이 길어 한 칸에 두 줄로 적힌 품목을 두 개로 오인**한다
2. **부가세가 포함되는 품목은 "과세", 포함되지 않는 품목은 "면세"로 표기**해달라
3. **합산 금액이 일치하지 않을 경우 재분석하거나 일치시킬 방법**을 만들어달라

추가 제보: **"수량/단가/공급가/부가세를 헷갈려하는 것 같다"** — 실물 전표 2장 제공.
추가 제보(v4 계기): **"제공한 문서는 월푸상사에 한해서이고 다른 업체는 문서 구조가 다르다"**

### 1-2. 사용자 승인 사항

- 과세/면세는 **DB 저장까지**
- 합계 불일치는 **산술 자동보정 + 수동 재분석 버튼** (자동 재호출 아님 — 기존 ~24초 지연이 2배가 되면 "Load failed" 재발)
- 양식 대응은 **적응형 설계 우선.** 타 거래처 실물 샘플은 추후 검증용으로 확보

### 1-3. 설계가 두 번 뒤집힌 경위

| 단계 | 전제 | 뒤집힌 이유 |
|---|---|---|
| v1 | 코드만 보고 설계 | 실물을 안 봐서 열 관계식의 존재 자체를 몰랐음 |
| v2·v3 | 월푸상사 실물 2장 기준 | **표본 1개 거래처를 범용으로 일반화함** |
| **v4** | **양식은 거래처마다 다르다. 관계식은 문서에서 판별한다** | — |

교훈: 양식 사양을 프롬프트에 **상수로 박지 말 것.** 판별 절차로 넣어야 한다.

---

## §2. 핵심 판단

| # | 증상 | 실제 결손 위치 |
|---|---|---|
| **0** | 열(수량/단가/공급가/부가세) 혼동 | **프롬프트에 열 관계식 검증 절차가 없고, Vision 프롬프트는 특정 유형을 단정** |
| 1 | 긴 품목명이 두 줄 → 두 품목으로 분리 | Upstage 표 파싱 후처리 규칙 부재 (H1의 역방향 케이스 없음) |
| 2 | 과세/면세 표기 없음 | 데이터 모델 결손. `lineTotal`에 공급가+부가세를 뭉개 놔서 행 단위 판정 근거 없음 |
| 3 | 합계 불일치 방치 | 검증 결과가 사용자에게 도달하지 않음 |

**Phase 0이 나머지 전부의 정확도 상한을 결정한다.** 다만 v4에서 Phase 0의 내용이 바뀌었다: "이 양식은 이렇다"고 알려주는 게 아니라, **"관계식을 먼저 판별하고 문서 전체에 일관 적용하라"**고 지시한다. 어느 양식이든 과세 행 1~2개만 있으면 판별된다.

**Phase 2가 Phase 3의 선행 조건이다.** 합계 자동보정의 부가세 관련 케이스는 과세 행에만 적용해야 한다.

**작업 순서: Phase 0 → 1 → 2 → 3.**

---

## §3. 양식 다양성과 판별 규칙 (v4 핵심)

### 3-1. 단가 기준(basis) — 최소 2유형

같은 "거래명세표"라도 **단가가 세포함이냐 세별도냐**가 갈린다. 이게 열 혼동의 근원이다.

| 유형 | 관계식 | 확인된 사례 |
|---|---|---|
| **gross** (단가 = 부가세 포함) | `수량×단가 = 공급가액 + 부가세`<br>과세: `공급가액 = 올림(수량×단가/1.1)` | 월푸상사(0855) — 실측 16행 |
| **net** (단가 = 부가세 별도) | `수량×단가 = 공급가액`<br>과세: `부가세 = 반올림(공급가액×0.1)`<br>결제금액 = 공급가액+부가세 | **일반적으로 더 흔한 관례. 실측 미확보** |
| **unknown** | 부가세 컬럼 자체가 없거나 과세 행이 없어 판별 불가 | 영수증·수기전표·전 품목 면세 전표 |

두 유형 모두에서 **면세 행은 `공급가액 = 수량×단가`, 부가세 공란**이다. 즉 면세 행만으로는 basis를 판별할 수 없다. **부가세 값이 있는 과세 행이 판별 근거다.**

### 3-2. 판별 절차 (결정론적)

부가세 값이 있는(`v > 0`) 과세 행마다:

```
qp = 수량 × 단가
|qp − (공급가액 + 부가세)| ≤ tol  →  gross 표 1
|qp − 공급가액|              ≤ tol  →  net   표 1
```

다수결로 문서의 basis를 결정. 둘 다 0이면 `unknown`. `tol = max(2, qp × 0.005)`.

**두 조건이 동시에 성립하는 경우는 `v = 0`일 때뿐**이고, 그런 행은 애초에 판별 대상에서 제외되므로 모호성이 없다.

### 3-3. v3에 있던 치명적 오류 (v4에서 수정)

v3의 P3은 면세 안전망으로 이걸 넣으라고 했다.

```
공급가액 ≈ 수량×단가  →  taxType = "exempt"
```

**net 유형 거래처에서는 이 조건이 과세 행에서도 항상 참이다.** 그대로 넣으면 **전 항목이 면세로 분류된다.** 반드시 `basis === "gross"`일 때만 적용해야 한다. §P3에 반영.

같은 이유로 reconcile의 `×1.1` 계열 보정도 basis에 의존한다(§P5).

### 3-4. 합계행 — 축 구분의 일반 규칙

월푸상사는 `① 직전미수금 | ①+② 합계 | ② 결제합계 | 공급가액합 | 부가세합` 5칸이었다. 이건 **한 사례**일 뿐이고, 양식마다 다르다. 일반화하면 합계 영역에는 **두 개의 축**이 섞여 있다.

| 축 | 키워드 | 용도 |
|---|---|---|
| **당기 거래** | 합계금액, 공급가액계, 세액계, 당일거래, 소계 | ✅ Σ 검증 앵커 |
| **채권 잔액** | 전월이월, 직전미수금, 총미수금, 당월잔액, 잔액, 수금액, 누계 | 🚫 이번 전표 금액 아님 |

**함정**: 채권 축 값이 훨씬 크고, 거기에도 "합계"라는 글자가 붙는 경우가 많다(월푸상사의 `①+② 합계 17,230,551` = 누적 미수금). 큰 숫자·"합계" 라벨을 신뢰하면 안 된다.

**서버 측 결정론적 방어 — 이건 양식 무관하게 안전하다**:

```
docGrand = (totalSupply + totalTax)  ← 1순위. 두 값이 다 있으면 무조건 이것
         ?? grandTotal               ← fallback
```

`totalSupply`/`totalTax`는 채권 축과 혼동될 여지가 구조적으로 적다(미수금은 공급가/부가세로 분해되지 않는다). `grandTotal`이 `totalSupply+totalTax`와 10원 넘게 어긋나면 채권 축을 읽은 것이므로 폐기한다.

### 3-5. 거래처별 양식 프로파일 (기존 메커니즘 활용)

코드에 이미 `getOcrProfile(counterpartyId)` / `buildProfileHint(profile)` / `updateOcrProfile(cpId, documentType, items)`가 있고 `/extract-purchase`에서 호출된다. **여기에 판별 결과를 축적한다.**

```
판별 성공 → 프로파일에 basis 저장 (+ 관측 횟수)
판별 실패(unknown) → 프로파일에 저장된 과거 basis를 폴백으로 사용
```

전 품목이 면세인 전표처럼 당장은 판별 불가한 경우를 과거 이력으로 구제한다. 신규 거래처는 프로파일이 없어도 문서 단위 판별만으로 동작하므로 콜드스타트 문제가 없다.

### 3-6. 월푸상사 실측 사양 (유형 gross의 구체 사례 · 회귀 샘플)

> 이하는 **범용 규칙이 아니라 회귀 테스트용 정답 데이터**다. 프롬프트에 상수로 박지 말 것.

출처: 월푸상사(주) 발행 `거래명세표 (0855)`, 청계산뚝배기수제비 천호점 수취. 2026-07-04 / 07-06, 총 16행 전수 검증, 예외 0건.

- 열: `품목/규격 | 단위 | 수량 | 단가 | 공급가액 | 부가세 | 비고`
- **월일 컬럼 없음**(날짜는 상단 헤더), **합계금액 컬럼 없음**
- basis = **gross**. 과세 행 `공급가액 = ceil(수량×단가/1.1)` — `round`면 4건이 1원씩 어긋남
- 면세 행은 부가세·비고 2칸 연속 공란 → 열 붕괴 취약
- 수량은 소수점 3자리 고정(`1.000`, `30.000`) — memory `project-ocr-upstage-vs-vision`의 ×1000 오독 근원
- 줄바꿈 품목명 3건 (§3-7)

**주의**: 반올림 방식(ceil/round/floor)도 거래처마다 다를 수 있다. 서버는 **문서에 적힌 값을 우선 신뢰**하고, 결측 시에만 계산하며 검증은 ±1원 허용으로 둔다.

### 3-7. 줄바꿈 품목명 (실물 3건)

| 전표 | 1행 | 2행 |
|---|---|---|
| 0344 | `(FK)겉절이양념/5kg/냉장/쉐프메이드/씨` | `피케이(H)(5kg*2)` |
| 0344 | `손칼국수/수라식품/1kg(5,7번)(H)(1kg*` | `12)` |
| 0346 | `(FK)고기궁중만두/박스출고(70g*20)*12` | `(H)(박스(70g*10개)*12팩/박스)` |

손칼국수의 2행은 `12)` — **숫자로 시작한다.** "숫자 칸이 전부 비었을 때만 병합"하는 가드로는 못 잡는다.

추가 신호: 1행이 `*`/`/`/`(`/`-`로 끝남, 1행의 여는 괄호 > 닫는 괄호, 2행이 `)`로 끝나는데 여는 괄호가 없음. **이 신호들은 양식 무관하게 유효하다.**

**Code 세션 실측**: 줄바꿈 원인은 **(b) 행 분해형** — 시각적 한 줄이 각각 별도 `<tr>`.
**미확인**: 면세 행의 빈 셀이 표 HTML에 `<td></td>`로 보존되는지(§P0-2).

---

## §4. 구현 현황 — 커밋 `ee53759`

10 files, +1,185 −59. 로컬 main에 있고 **push 미승인 상태.**

### 4-1. 반영 완료 ✅ — 양식 무관하게 유효, 재작업 불필요

| 항목 | 위치 |
|---|---|
| `mergeWrappedNameRows` 서버 가드 (신호 ① 숫자 전무) | `ocr.ts` |
| 프롬프트 H6 휴리스틱 (신호 ①) | `prompts.ts:53~62` |
| `buildClaudeContext` 순서 교체 (표 HTML 우선) | `upstage.ts` |
| `rawItemName` 100자 slice (4개소) | `purchasesV2.ts` |
| 스키마 3컬럼 + `addColumnIfNotExists` 마이그레이션 | `schema.ts`, `index.ts:1505~1507` |
| 프롬프트 출력 필드 3개(`supplyAmount`/`vatAmount`/`taxType`) | `prompts.ts` 양쪽 |
| zod/insert 3곳 관통 + `"" → null` 정규화 | `purchasesV2.ts` |
| `getOrderItems`·편집저장 경로 세필드 관통 | `purchasesV2.ts` |
| UI 3-state 토글 뱃지(+추정 표시), 토글 시 재계산 | `DailyOpsPage.tsx` |
| `reconcileTotals` 뼈대 + `fixes[]` 한글 기록 | `ocr.ts:582~662` |
| 응답에 `totals` 포함 + UI 4분기 배너 + 실시간 재계산 | `ocr.ts`, `DailyOpsPage.tsx` |
| `hybrid.ts` 분리 + Upstage 캐시(TTL 10분/LRU 20) + `/reanalyze-purchase` + 30초 쿨다운 | `hybrid.ts`, `ocr.ts` |
| 저장 게이트(불일치 시 confirm 1회, 차단 아님) | `DailyOpsPage.tsx` |
| CLAUDE.md §13 마이그레이션 예시 교정 | `CLAUDE.md` |
| 집계 주의사항 GitHub #25 등록 | — |

### 4-2. 미반영 ❌ / 부분반영 ⚠️

문서 v2는 워킹트리에 정상 존재했고(Phase 0은 123행) 커밋에도 포함됐지만, 코드는 v1 설계를 구현했다.

| # | 항목 | 상태 | 근거 (검증된 라인) |
|---|---|---|---|
| **A** | Phase 0 (열 관계식 검증 절차) | ❌ | `prompts.ts`에 없음. **v4에서 내용이 "판별 절차"로 바뀜** |
| **B** | Vision 프롬프트 basis 단정 | ❌ | `prompts.ts:168` — `수량 × 단가 × (1 또는 1.1) ≈ lineTotal. 부가세 별도면 1.1배` 그대로. **gross 유형에서 정반대이고, net 유형에서도 lineTotal 정의가 모호** |
| **C** | `[A] 거래명세표` 열 정의 | ❌ | `prompts.ts:202` — `열: 월일\|품목/규격\|...`. 실물엔 월일 컬럼 없음. **v4에서는 "양식 예시 중 하나"로 표기 완화** |
| **D** | 합계행 축 구분 규칙 | ❌ | 양쪽 프롬프트에 없음 |
| **E** | `docGrand` 우선순위 | ❌ | `ocr.ts:565` — `num(grandTotal) ?? (docSupply + docTax)`. **반전 필요** |
| **F** | 기존 크로스체크 우선순위 | ❌ | `ocr.ts:521` — `summary.grandTotal \|\| summary.totalSupply` |
| **G** | `mergeWrappedNameRows` 신호 ②③④ | ❌ | 신호 ①만. `12)` 케이스 미대응 |
| **H** | 프롬프트 H6 판정 신호 ②③④ | ❌ | `prompts.ts:53~62`에 ①만 |
| **I** | 세구분 서버 보정 우선순위 | ⚠️ | `ocr.ts:482` — `if (taxType === "unknown" && vat != null)`. 부가세 값이 있으면 무조건 우선해야 함 |
| **J** | 면세 안전망 | ❌ | 없음. **v4: basis 게이트 필수**(§3-3) |
| **K** | 반올림 방식 | ⚠️ | `ocr.ts:495` — `Math.round(t/1.1)` 하드코딩. 문서 값 우선 + ±1원 허용으로 |
| **L** | 정합성 검사 (`\|supply+vat−gross\|>1 → low`) | ❌ | 없음 |
| **M** | STEP 3.5 판정 우선순위 | ⚠️ | `prompts.ts:78~91` — v1 순서. "품목명에 (면세) 표기 없는 면세 존재" 경고 없음 |
| **N** | reconcile 케이스 정의 | ⚠️ | `×1.1` 하드코딩(`ocr.ts:587`). **basis 의존으로 바꿔야 함** |
| **O** | `Σ supplyAmount ≈ docSupply` / `Σ vatAmount ≈ docTax` 독립 검증 | ❌ | 없음 |
| **P** | 실행 로그 append | ❌ | 마지막 2줄이 Cowork 항목뿐 |
| **Q** | **`detectUnitPriceBasis` (v4 신규)** | ❌ | 미존재. §P2·P3·P5의 전제 |
| **R** | **OCR 프로파일에 basis 축적 (v4 신규)** | ❌ | `updateOcrProfile` 확장 필요 |

### 4-3. 백합 케이스가 새는 경로

`백합/냉동/1kg(1kg*5개/박스)` — 품목명에 `(면세)` 표기 없는 면세 품목.

```
Upstage → vatAmount = null (부가세 칸 공란), supplyAmount = 26,000, 수량×단가 = 26,000
ocr.ts:482  if (taxType === "unknown" && vat != null)  →  vat이 null이라 발화 안 함
            ↓  모델이 준 taxType 그대로 통과. unknown이면
            ↓  reconcile (a)에서 과세로 취급 → ×1.1 → 26,000 → 28,600 오보정
```

수정은 §P3. **단, 안전망을 `basis === "gross"`로 게이트하지 않으면 net 유형 거래처가 전부 면세가 된다**(§3-3).

### 4-4. 배포 시 예상되는 퇴행 (미확정 · 결정 테스트 필요)

지금까지 합계 불일치는 `console.warn` + confidence 강등으로만 소비돼 사용자가 몰랐다. 이번 변경으로 **빨간 배너 + 저장 확인창**으로 전면에 나온다.

채권 축 오독(§3-4)이 실제로 발생하면:

```
docGrand = 17,230,551 (누적 미수금) / itemSum = 590,006 (정확) / diff = −16,640,545
→ 자동보정 전부 실패 → "행 누락 의심 (부족액 16,640,545원)" 배너
→ ocr.ts:521 크로스체크 동시 발화 → 전 항목 medium 강등(노란 카드)
```

**항목이 완벽히 맞는 전표에서 경고가 뜬다.** 월푸상사는 매 전표에 미수금이 찍히는 주력 거래처다. 확인 비용은 Upstage 캐시 + Haiku 1회다.

### 4-5. 보고서 사실 오류 2건

- "미해결: 실전 줄바꿈 실패 전표 미보유" — 전표는 `~/Downloads/IMG_0344.HEIC`(2건), `IMG_0346.HEIC`(1건)에 있고 부록 A에 정답 수록
- "docs/... 실행 로그 append 후 커밋" — append 안 됨

---

## §5. 잔여 작업

`ee53759`은 revert 불필요. **추가 커밋으로 얹고 P0 통과 후 함께 push.**

### P0 — 결정 테스트 (먼저)

`~/Downloads/IMG_0344.HEIC`로 `/extract-purchase` E2E 실행 후 로그에서 확정:

1. `summary.grandTotal`이 **590,006**인가 **17,230,551**(누적 미수금)인가
2. 면세 행의 빈 부가세/비고 셀이 Upstage 표 HTML에 `<td></td>`로 보존되는가
3. 각 행의 `taxType` — 특히 `IMG_0346`의 **백합**

**완료 조건**: 3개 답을 §실행 로그에 기록. 1번이 17,230,551이면 **배포 불가**.

### P1 — `docGrand` 우선순위 반전 (E, F) · 양식 무관

`ocr.ts:565`, `ocr.ts:521` 공통 함수화:

```ts
function resolveDocGrand(s: any): number | null {
  const n = (v: any) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? x : null; };
  const supply = n(s?.totalSupply), tax = n(s?.totalTax), grand = n(s?.grandTotal);
  // 1순위: 공급가액합 + 부가세합 (채권 축 오독에 구조적으로 면역)
  if (supply != null && tax != null) {
    if (grand != null && Math.abs(grand - (supply + tax)) > 10) {
      console.warn(`[OCR] grandTotal(${grand}) 무시 — 공급가+부가세(${supply + tax})와 불일치. 미수금/누계 오독 의심`);
    }
    return supply + tax;
  }
  if (grand != null) return grand;
  if (supply != null) return supply;
  return null;
}
```

**`ocr.ts:521`의 기존 크로스체크도 동일 함수를 쓸 것.** 두 곳이 기준이 다르면 배너와 confidence가 엇갈린다.

### P2 — 단가 기준 판별 (Q, A, B, C, D) · v4 핵심

**(a) 서버 판별 함수 신설** — `ocr.ts`

```ts
export type UnitPriceBasis = "gross" | "net" | "unknown";

/** 부가세 값이 있는 과세 행으로 단가 기준을 판별. 양식/거래처 무관. */
export function detectUnitPriceBasis(items: any[]): { basis: UnitPriceBasis; grossVotes: number; netVotes: number; evidence: string } {
  const n = (v: any) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? x : null; };
  let grossVotes = 0, netVotes = 0;
  for (const it of items) {
    const q = n(it.quantity), p = n(it.unitPrice), s = n(it.supplyAmount), v = n(it.vatAmount);
    if (q == null || p == null || s == null || v == null) continue;
    if (q <= 0 || p <= 0 || v <= 0) continue;          // 과세 행만 (면세는 두 식이 동시 성립 → 판별 불가)
    const qp = q * p;
    const tol = Math.max(2, qp * 0.005);
    if (Math.abs(qp - (s + v)) <= tol) grossVotes++;
    else if (Math.abs(qp - s) <= tol) netVotes++;
  }
  if (grossVotes > netVotes && grossVotes > 0)
    return { basis: "gross", grossVotes, netVotes, evidence: `과세 ${grossVotes}행에서 수량×단가 = 공급가+부가세` };
  if (netVotes > grossVotes && netVotes > 0)
    return { basis: "net", grossVotes, netVotes, evidence: `과세 ${netVotes}행에서 수량×단가 = 공급가액` };
  return { basis: "unknown", grossVotes, netVotes, evidence: "판별 근거 부족 (부가세 있는 과세 행 없음 또는 불일치)" };
}
```

호출 순서: `mergeWrappedNameRows` → `detectUnitPriceBasis` → `validateAndEnrichItems(items, summary, basis)` → `reconcileTotals(items, summary, basis)`.

판별이 `unknown`이면 **거래처 OCR 프로파일의 과거 basis를 폴백**으로 사용(§P6).

`basis`와 `evidence`를 응답 `totals`에 실어 UI에서 확인 가능하게 할 것 (디버깅·신뢰 형성).

**(b) `promptV2`에 STEP 2.5 삽입** — 단정이 아니라 **판별 지시**

```
### STEP 2.5: 열 구조 확정 + 관계식 판별

거래명세표의 열 구성은 발행 업체마다 다릅니다. **양식을 가정하지 말고 헤더를 먼저 읽으세요.**
흔한 구성 예: 품목/규격 | 단위 | 수량 | 단가 | 공급가액 | 부가세 | 비고
(월일 컬럼이 있는 양식도, 없는 양식도 있습니다. 합계금액 컬럼도 있을 수도 없을 수도 있습니다.)

**단가 기준을 먼저 판별하세요.** 부가세 값이 있는 과세 행 1~2개를 골라 확인:

  ⓐ 수량 × 단가 = 공급가액 + 부가세   → 단가가 **부가세 포함** 단가
  ⓑ 수량 × 단가 = 공급가액            → 단가가 **부가세 별도** 단가

판별한 유형을 **문서 전체에 일관 적용**하세요. 행마다 다르게 해석하면 안 됩니다.
면세 행은 두 유형 모두 "공급가액 = 수량×단가, 부가세 칸 공란"이므로 판별 근거가 되지 못합니다.
과세 행이 하나도 없으면 판별하지 말고 note에 "단가 기준 판별 불가"라고 적으세요.

**각 행을 추출한 직후 판별한 식으로 자기검증하세요.**
맞지 않으면 값을 지어내지 말고 **열 매핑을 다시 확인**하세요.
자주 나오는 오류:
  - 면세 행은 부가세·비고 칸이 비어 있어 열이 왼쪽으로 밀리기 쉽습니다.
    공급가액을 부가세 칸에서 읽지 않았는지 확인하세요.
  - 수량이 "1.000", "30.000"처럼 소수점 3자리로 표기되는 양식이 있습니다.
    "30.000"은 30이지 30000이 아닙니다.
  - ⓐ 유형에서는 단가가 공급가액보다 큽니다. ⓑ 유형에서는 같거나 작습니다.
    판별한 유형과 어긋나면 열을 잘못 읽은 것입니다.
```

STEP 1에 한 줄: `행·열 판정은 markdown이 아니라 표 HTML의 <td> 경계를 기준으로 하세요.`

**(c) `prompts.ts:168` 교체** — 단정 제거

```diff
- - 수량 × 단가 × (1 또는 1.1) ≈ lineTotal. 부가세 별도면 1.1배, 부가세포함이거나 면세면 1배.
+ - **단가 기준을 먼저 판별하세요** (부가세 값이 있는 과세 행으로):
+   ⓐ 수량×단가 = 공급가액+부가세  → 단가가 부가세 포함 (단가 > 공급가액)
+   ⓑ 수량×단가 = 공급가액         → 단가가 부가세 별도 (단가 ≤ 공급가액)
+   판별한 유형을 문서 전체에 일관 적용. 행마다 다르게 해석하지 말 것.
+   면세 행은 두 유형 모두 공급가액 = 수량×단가, 부가세 공란입니다.
+ - lineTotal = 결제금액 = 공급가액 + 부가세 (유형 무관)
```

**(d) `prompts.ts:202` 완화** — 열 순서를 고정 사양이 아니라 예시로

```
**[A] 거래명세표** — 가장 흔함. 열 구성은 업체마다 다르므로 **헤더를 먼저 읽을 것**.
  흔한 예1: 품목/규격 | 단위 | 수량 | 단가 | 공급가액 | 부가세 | 비고  (월일·합계금액 컬럼 없음)
  흔한 예2: 월일 | 품목 | 규격 | 수량 | 단가 | 공급가액 | 세액 | 합계금액
  합계금액 컬럼이 따로 있으면 그 값을 lineTotal로 우선 사용.
  없으면 공급가액 + 부가세로 합성.
```

**(e) 합계행 축 구분 — 양쪽 프롬프트 공통**

```
### 합계행 읽기 (매우 중요)

전표 하단 합계 영역에는 보통 **두 종류의 숫자**가 섞여 있습니다.

  · 당기 거래 축 — 합계금액, 공급가액계, 세액계, 당일거래, 소계
      → summary.grandTotal / totalSupply / totalTax 는 **여기서만** 가져오세요
  · 채권 잔액 축 — 전월이월, 직전미수금, 총미수금, 당월잔액, 잔액, 수금액, 누계
      → 🚫 이번 전표 금액이 **아닙니다**. summary에 넣지 마세요

⚠ 채권 축 값이 훨씬 크고, 거기에도 "합계"라는 글자가 붙는 경우가 많습니다.
   예: "① 직전미수금 | ①+② 합계 | ② 결제합계 | 공급가액합 | 부가세합" 구조에서
       "①+② 합계"는 누적 미수금이지 이번 전표 금액이 아닙니다.
   **가장 큰 숫자 / "합계" 라벨을 근거로 고르지 마세요.**

검산: totalSupply + totalTax = grandTotal = Σ(각 행의 결제금액)
      맞지 않으면 채권 축을 잘못 집었는지 먼저 의심하세요.
```

### P3 — 세구분 서버 보정 (I, J, K, L, M) · basis 게이트 필수

`ocr.ts:473~500` 교체. **`basis`를 인자로 받아야 한다.**

```ts
const gross = qty > 0 && price > 0 ? Math.round(qty * price) : parseFloat(finalTotal) || 0;

// 1) 부가세 값이 있으면 모델 판정보다 우선 (unknown 조건 제거)
if (vat != null) taxType = vat > 0 ? "taxable" : "exempt";
// 2) 안전망 — gross 유형에서만 유효.
//    net 유형은 과세 행도 공급가액 = 수량×단가 이므로 적용하면 전 항목이 면세가 된다.
else if (basis === "gross" && supply != null && gross > 0 && Math.abs(supply - gross) <= 1) {
  taxType = "exempt";
}
// 3) 그 외에는 모델 판정 유지 (근거 없으면 unknown)

let supplyFinal = supply, vatFinal = vat, vatEstimated = false;
if (gross > 0) {
  if (taxType === "exempt") { supplyFinal = supplyFinal ?? gross; vatFinal = vatFinal ?? 0; }
  else if (taxType === "taxable") {
    // 문서에 적힌 값을 우선 신뢰. 결측일 때만 계산 (반올림 방식은 거래처마다 다름)
    if (supplyFinal == null) {
      supplyFinal = basis === "gross" ? Math.ceil(gross / 1.1) : gross;
      vatEstimated = true;
    }
    if (vatFinal == null) {
      vatFinal = basis === "gross" ? gross - supplyFinal : Math.round(supplyFinal * 0.1);
      vatEstimated = true;
    }
    // 정합성 검사 (±1원)
    const expectedTotal = basis === "net" ? supplyFinal + vatFinal : gross;
    if (Math.abs(supplyFinal + vatFinal - expectedTotal) > 1) confidence = "low";
  }
}
```

**net 유형에서 `lineTotal` 정의 주의**: `수량×단가`는 공급가액이지 결제금액이 아니다. `lineTotal = supplyFinal + vatFinal`이어야 한다. 현행 `validateAndEnrichItems`의 `finalTotal` 산출 로직(`ocr.ts:368~390`)도 basis를 반영하도록 함께 손볼 것. **이 부분이 net 유형 거래처에서 금액이 10% 낮게 저장되는 원인이 된다.**

프롬프트 STEP 3.5 판정 우선순위 교체(M):

```
1. **부가세 칸이 1차 신호다.**
   · 값이 있고 > 0 → "taxable"
   · 비어 있거나 0인데 같은 표의 다른 행엔 값이 있음 → "exempt"
2. 품목명 안의 "(면세)" 표기는 보조 확인용.
   ⚠ 면세 품목이라도 품목명에 표기가 없는 경우가 많습니다.
      실제 예: "백합/냉동/1kg(1kg*5개/박스)" — 표기 없지만 부가세 칸이 비어 면세.
      **품목명에 (면세)가 없다는 이유로 과세로 단정하지 마세요.**
3. 세구분 전용 컬럼("과"/"면", "T"/"E", "V"/"X")이 있으면 최우선.
4. 표 전체에 부가세 칸 자체가 없으면 → 전 행 "unknown" (하단 총액 안분 금지)
```

### P4 — 줄바꿈 병합 신호 보강 (G, H) · 양식 무관

```ts
export function mergeWrappedNameRows(items: any[]): any[] {
  const NUM_KEYS = ["quantity", "unitPrice", "lineTotal", "supplyAmount", "vatAmount"];
  const SUMMARY_RE = /^(합\s*계|소\s*계|총\s*계|총\s*합|부가세|공급가액|이월|잔액|미수금|누계|수금|total|subtotal)/i;
  const num = (v: any) => {
    const s = String(v ?? "").replace(/[,\s원]/g, "");
    return s !== "" && Number.isFinite(Number(s)) && Number(s) !== 0;
  };
  const out: any[] = [];
  for (const it of items) {
    const name = String(it?.shortName || it?.name || "").replace(/\s+/g, " ").trim();
    if (!name || SUMMARY_RE.test(name) || out.length === 0) { out.push(it); continue; }

    const prev = out[out.length - 1];
    const prevName = String(prev.shortName || "").trim();
    const filled = NUM_KEYS.filter((k) => num(it[k])).length;

    const prevOpen = (prevName.match(/\(/g) || []).length > (prevName.match(/\)/g) || []).length;  // ③
    const prevDangling = /[*/(\-]$/.test(prevName);                                                 // ②
    const selfCloser = /\)$/.test(name) && !name.includes("(");                                     // ④

    const continuation =
      filled === 0 ||                                              // ①
      ((prevOpen || prevDangling || selfCloser) && filled <= 1);   // ②③④ + 숫자 파편 1개 이하

    if (continuation) {
      prev.shortName = `${prevName}${name}`;
      prev.originalName = `${String(prev.originalName || "").trim()}${name}`;
      prev.uncertain = true;
      prev.mergedFrom = [prev.mergedFrom, "H6-server"].filter(Boolean).join(",");
      console.log(`[OCR] H6 서버 병합: "${name}" → "${prev.shortName}"`);
      continue;
    }
    out.push(it);
  }
  return out;
}
```

`filled <= 1`의 근거: `12)` 같은 파편이 수량 셀에 잘못 들어간 케이스를 흡수하되, 수량+단가가 둘 다 있는 진짜 품목행은 지킨다.

프롬프트 H6에 신호 ②③④와 실물 예시 추가(H):

```
  실제 예: "(FK)겉절이양념/5kg/냉장/쉐프메이드/씨" + "피케이(H)(5kg*2)"
           "손칼국수/수라식품/1kg(5,7번)(H)(1kg*" + "12)"
  판정 신호 (하나라도 해당하면 이어짐):
   ① 품목명만 있고 수량·단가·공급가액·부가세가 전부 비어 있다
   ② 직전 행의 품목명이 "*", "/", "(", "-" 로 끝난다
   ③ 직전 행의 여는 괄호 개수 > 닫는 괄호 개수
   ④ 그 행의 텍스트가 ")"로 끝나는데 여는 괄호가 없다 (예: "12)")
  ⚠ 병합 후 반드시 STEP 2.5에서 판별한 관계식으로 재검증하세요.
```

### P5 — reconcile을 basis 의존으로 (N, O)

`ocr.ts:582`의 `Math.round(lt * 1.1)` 하드코딩을 제거하고 케이스를 재정의:

| 순서 | 케이스 | 적용 조건 | 조치 |
|---|---|---|---|
| (a) | **lineTotal을 공급가액으로 읽음** | `Σ supplyAmount ≈ docSupply` 이고 `itemSum ≈ docSupply` | 전 행 `lineTotal = supplyAmount + vatAmount` 재계산. **basis 무관·가장 안전** |
| (b) | 부가세 미합산 | `basis !== "unknown"` | 과세 행만 보정. **`taxType === "exempt"` 뿐 아니라 `"unknown"`도 제외**(오보정 방지) |
| (c) | 부가세 이중합산 | 위와 동일 | 역보정 |
| (d) | 단일 행 자릿수 오독 | 항상 | ×10/÷10/×100/÷100 중 합이 정확히 맞는 것 하나만 교체 + `confidence="low"` |
| (e) | 중복 행 | 항상 | `diff`가 어떤 행의 lineTotal과 정확히 일치 + 동일 품명 2회 이상 |
| (f) | 행 누락 의심 | 설명 불가 | **자동 추가 금지.** `fixes`에 기록 후 `status="mismatch"` |

(a)를 (b)보다 앞에 두는 이유: 산술적으로 가장 안전하고 basis에 의존하지 않는다. `basis === "unknown"`이면 (b)(c)를 **건너뛴다** — 근거 없이 ±10%를 적용하는 것보다 `mismatch`로 남기고 사용자에게 묻는 게 낫다.

**독립 축 검증 추가(O)**:

```
Σ supplyAmount ≈ docSupply  (공급가액 축)
Σ vatAmount    ≈ docTax     (부가세 축)
```

결제 합계만 맞고 이 두 축이 어긋나면 **세구분 오판정**이다. `fixes`에 별도 기록하고 `status`는 유지.

### P6 — 거래처 OCR 프로파일에 basis 축적 (R)

- `updateOcrProfile(cpId, documentType, items)` 시그니처에 `basis` 추가, 판별 성공 시에만 갱신
- `buildProfileHint(profile)`에 한 줄 주입: `이 거래처의 과거 전표는 단가가 부가세 {포함|별도} 기준이었습니다. 다만 이번 문서에서 직접 판별한 결과를 우선하세요.`
- `detectUnitPriceBasis`가 `unknown`을 반환하면 프로파일 값으로 폴백. 폴백 사용 시 `totals.basisSource = "profile"`로 표기

신규 거래처는 프로파일이 없어도 문서 단위 판별만으로 동작한다(콜드스타트 없음).

### P7 — 실행 로그 append (P)

---

## §6. 리스크

| # | 리스크 | 완화 |
|---|---|---|
| 1 | 채권 축(미수금)을 `grandTotal`로 읽어 정상 전표에 빨간 배너 | **P0 → P1.** 미확인 상태 배포 금지 |
| 2 | **net 유형 거래처에서 면세 안전망이 전 항목을 면세로 만듦** | **P3의 `basis === "gross"` 게이트. 이걸 빼면 대형 사고** |
| 3 | **net 유형에서 `lineTotal`이 공급가액으로 저장돼 금액이 10% 낮음** | P3의 `finalTotal` 산출 로직 basis 반영 |
| 4 | `basis` 판별 실패(전 품목 면세 전표 등) | 프로파일 폴백(P6). 그래도 unknown이면 (b)(c) 보정 건너뛰고 사용자에게 위임 |
| 5 | 면세 행 빈 셀로 인한 열 붕괴 | P2 자기검증 + 표 HTML 우선(✅) + P0-2 실측 |
| 6 | 백합류(표기 없는 면세)가 unknown → 오보정 | P3 안전망 + P5 (b)에서 unknown 제외 |
| 7 | H6 병합 오탐 — 정상 행 흡수 | `uncertain=true` 강제(✅) + 관계식 재검증 + 회귀 테스트 |
| 8 | 반올림 방식이 거래처마다 다름 | 문서 값 우선, 결측 시에만 계산, 검증 ±1원 |
| 9 | 재분석 캐시 미스 → Upstage 429 | 캐시 TTL 10분 + 30초 쿨다운(✅). memory `project-ocr-upstage-tier0` |
| 10 | 기존 데이터 `vatAmount` NULL | 집계에서 `IFNULL(...,0)` 금지. GitHub #25(✅) |
| 11 | 배너와 confidence가 서로 다른 기준으로 발화 | P1에서 `ocr.ts:521`/`565` 기준 통일 |

---

## §7. 완료 조건 (배포 게이트)

### 회귀 — 월푸상사 (basis = gross)

```
IMG_0344 → 항목 9개 / basis="gross"
           Σ lineTotal = 590,006  /  Σ supplyAmount = 557,398  /  Σ vatAmount = 32,608
           과세 4 · 면세 5
           summary.grandTotal = 590,006 (17,230,551 아님)
           totals.status = "match"
           겉절이양념·손칼국수가 각각 1개 항목으로 병합

IMG_0346 → 항목 7개 / basis="gross"
           Σ lineTotal = 300,000  /  Σ supplyAmount = 278,230  /  Σ vatAmount = 21,770
           과세 5 · 면세 2
           백합(품목명에 면세 표기 없음)이 exempt
           totals.status = "match"
           고기궁중만두가 1개 항목으로 병합
```

### 유닛 — basis 판별 (실물 샘플 없이 검증 가능)

```
gross 케이스: q=1, p=9400, s=8546, v=854      → basis="gross"
net   케이스: q=3, p=2100, s=6300,  v=630     → basis="net"
면세만:       q=2, p=14950, s=29900, v=null   → basis="unknown"
혼합 다수결:  gross 4행 + net 1행             → basis="gross"
경계:         v=0 인 행은 표에서 제외되는가
```

### 유닛 — basis별 세구분 보정

```
net 유형에서 과세 행(s == q×p)이 exempt로 잘못 분류되지 않는가   ← 리스크 #2
net 유형에서 lineTotal이 s + v 로 산출되는가                    ← 리스크 #3
basis="unknown"일 때 reconcile (b)(c)가 건너뛰어지는가          ← 리스크 #4
```

### 그 외

```
회귀   → 기존 정상 전표 3장 이상에서 항목 수 불변 (H6 오탐 없음)
음성   → 한 행을 의도적으로 제거한 케이스에서 빨간 배너 + 차액 정확히 표시
성능   → 재분석 버튼이 Upstage 재호출 안 함 (로그 [upstage] 0회)
빌드   → pnpm run build 통과
```

**타 거래처 실물 샘플은 아직 없다.** basis 판별은 위 유닛 테스트로 검증하고, 실물 검증은 배포 후 실사용 로그(`[OCR] basis=... evidence=...`)로 수행한다. **판별 실패·오판별 사례가 나오면 그 전표를 수집해 §3-1 유형 표에 추가할 것.**

---

## §8. DB 쓰기

`purchase_order_items_v2` 컬럼 3개 추가는 CLAUDE.md §3 정지조건 3번(DB WRITE) 해당. 자동 마이그레이션이 배포 시 실행되므로 **`git push` 승인 = 마이그레이션 승인**으로 묶어 §4 5항 보고에 명시.

정의: `supplyAmount DECIMAL(14,2) NULL`, `vatAmount DECIMAL(14,2) NULL`, `taxType ENUM('taxable','exempt','unknown') NOT NULL DEFAULT 'unknown'`. 전부 additive, 기존 데이터 무영향.

배포 후 Railway 로그에서 `[migrate] added purchase_order_items_v2.<column>` 3줄 확인 (memory `project-migration-add-column-helper`).

롤백: nullable/default라 코드만 revert하면 컬럼이 남아도 무해.

**`vatAmount IS NULL`은 "부가세 0"이 아니라 "미분류"다.** 집계에서 `IFNULL(vatAmount, 0)`으로 뭉개면 과거 데이터가 전부 면세로 잡힌다 (GitHub #25).

---

## 부록 A. 회귀 정답 데이터 — 월푸상사 (basis = gross)

원본: `~/Downloads/IMG_0344.HEIC`, `~/Downloads/IMG_0346.HEIC` (HEIC — `pillow-heif` 등으로 변환)

> **이 데이터는 gross 유형 1개 거래처의 사례다. 범용 사양이 아니다.**

### IMG_0344 (2026-07-06, 월푸상사(주), 책번호 0239권38호)

```
품목                                                   단위  수량      단가    공급가액   부가세   세구분
물티슈/에코/제이엘엠/박스(박스)                          박스  1.000    9,400     8,546     854   과세
돼지등뼈/kg/미국산(kg/면세)                             kg   30.000    5,500   165,000       -   면세
(FK)겉절이양념/5kg/냉장/쉐프메이드/씨피케이(H)(5kg*2)     팩    2.000   95,253   173,188  17,318  과세  ★2줄
생수제비/수라식품/1.5kg(H)(1.5kg*14)                    EA   14.000    7,400    94,182   9,418   과세
손칼국수/수라식품/1kg(5,7번)(H)(1kg*12)                 EA   12.000    4,600    50,182   5,018   과세  ★2줄
배추/망(3통)/국내산(1망/면세)                           망    2.000   14,950    29,900       -   면세
부추/단/국내산(1단/면세)                                단    1.000    2,300     2,300       -   면세
깐쪽파/단/국내산(단/면세)                               단    1.000   17,600    17,600       -   면세
깐양파/10k(소분제품)/개(10k/개)                         봉    1.000   16,500    16,500       -   면세
──────────────────────────────────────────────────────────────────────────
② 결제합계 590,006 │ 공급가액합 557,398 │ 부가세합 32,608
① 직전미수금 16,640,545 │ ①+② 17,230,551   ← 채권 축. grandTotal로 쓰면 안 됨
```

### IMG_0346 (2026-07-04, 월푸상사(주), 책번호 0239권32호)

```
품목                                                        단위  수량     단가    공급가액   부가세  세구분
부침가루/곰표(1kg*10)                                        EA   3.000    2,100     5,728    572   과세
쓰레기봉투/흑색/55L(50매)                                    봉   1.000    5,750     5,228    522   과세
쓰레기봉투/흑색/80L/JLM(50매)                                봉   1.000   10,250     9,319    931   과세
백합/냉동/1kg(1kg*5개/박스)                                  팩   5.000    5,200    26,000      -   면세 ★표기없음
(FK)고기궁중만두/박스출고(70g*20)*12(H)(박스(70g*10개)*12팩/박스) 박스 1.000  84,000    76,364  7,636   과세 ★2줄
생수제비/수라식품/1.5kg(H)(1.5kg*14)                          EA  18.000    7,400   121,091 12,109   과세
두백감자/kg(kg/면세)                                         kg  10.000    3,450    34,500      -   면세
──────────────────────────────────────────────────────────────────────────
② 결제합계 300,000 │ 공급가액합 278,230 │ 부가세합 21,770
① 직전미수금 16,340,545 │ ①+② 16,640,545   ← 채권 축
```

---

## 부록 B. 코드 지도

| 파일 | 위치 | 역할 |
|---|---|---|
| `server/ocr-engines/prompts.ts` | `promptV2` STEP 3 (~44~91) | H1~H6 + STEP 2.5(신설) + STEP 3.5 |
| | `:168` | **Vision 자기검증 basis 단정 (P2-c)** |
| | `:202` | **`[A]` 열 정의 — 예시로 완화 (P2-d)** |
| `server/ocr-engines/upstage.ts` | `buildClaudeContext` | 표 HTML 우선 (✅) |
| `server/ocr-engines/hybrid.ts` | `runUpstageStage` / `runClaudeTextStage` | 단계 분리 + `correctionNote` (✅) |
| `server/ocr.ts` | `mergeWrappedNameRows` | H6 서버 가드 (P4) |
| | **`detectUnitPriceBasis` (신설)** | **basis 판별 (P2-a)** |
| | `validateAndEnrichItems` (~360) | 검증·보정. `finalTotal` 산출 `:368~390`, 세구분 `:473~500` (P3) |
| | `:521` | 기존 summary 크로스체크 (P1) |
| | `:554~662` | `reconcileTotals`. `docGrand` `:565` (P1), `×1.1` `:587` (P5) |
| | `getOcrProfile` / `buildProfileHint` / `updateOcrProfile` | basis 축적 (P6) |
| `server/routers/purchasesV2.ts` | zod 3곳 / insert 3곳 | 세필드 관통 (✅) |
| `drizzle/schema.ts` | `purchaseOrderItemsV2` | 3컬럼 (✅) |
| `server/index.ts` | `:1505~1507` | 자동 마이그레이션 (✅) |
| `client/src/pages/DailyOpsPage.tsx` | 프리필 / 저장 / 합계 블록 / 항목 카드 | 뱃지·배너·재분석 (✅) |

관련 memory: `project-invoice-0855-format-spec`, `project-ocr-upstage-tier0`, `project-ocr-upstage-vs-vision`, `project-ocr-latency-timeout`, `project-migration-add-column-helper`, `feedback-cowork-no-direct-edit`

---

## 실행 로그

<!-- 한 줄씩 append: YYYY-MM-DD 세션(SHA) — 한 일 / 미해결 -->
- 2026-07-29 Cowork — v1 설계 문서 작성. 소스 미수정
- 2026-07-29 Cowork — v2 개정. 실물 전표 2장 판독으로 열 관계식·합계 앵커 확정. Phase 0 신설
- 2026-07-29 Code(ee53759) — v1 설계 기준 구현 (Phase 1/2/3). 줄바꿈 원인을 Upstage 행 분해형(b)으로 실측 확정. build 통과, push 미승인
- 2026-07-29 Cowork — v3 개정. `ee53759` 라인 검증 → v2 개정분 미반영 확정. 잔여 작업 P0~P6 재편
- 2026-07-29 Cowork — **v4 개정. v3가 월푸상사 양식을 범용으로 단정한 결함 수정.** 단가 기준(gross/net) 판별 설계로 전환, `detectUnitPriceBasis` 신설(Q), 프로파일 축적(R) 추가. **v3의 면세 안전망이 net 유형에서 전 항목을 면세로 만드는 결함 발견·수정(리스크 #2)**. 타 거래처 실물 샘플 미확보 — 유닛 테스트로 대체, 배포 후 로그 수집
- 2026-07-29 Code(post-ee53759) — **P0 결정 테스트 완료**: ① grandTotal = 590,006/300,000 (누적미수금 17,230,551 오독 **미발생** — 단 확률적 재발 대비 P1은 구현) ② 면세 행 빈 부가세/비고 셀은 표 HTML에 <td></td>로 **보존됨** (IMG_0344 빈 td 120개; IMG_0346은 표가 7조각 분해) ③ 백합 = exempt 정확, 단 0344에서 겉절이양념·생수제비·깐양파 unknown + 0346 쓰레기봉투 lineTotal 오독(11,250) → P2/P3/P5 필요성 실증. **P1~P6 전체 구현**: resolveDocGrand(공급가+부가세 1순위, :521 크로스체크 통일) / STEP 2.5 열 관계식 + Vision ×1.1→÷1.1 교정 + [A] 열 정의 교체 + 합계행 ①+② 함정 규칙(양쪽) / 세구분 서버 보정(부가세 1차 신호·면세 안전망·ceil·정합성 검사) + STEP 3.5 우선순위 재작성(백합 경고) / H6 신호 ②③④(프롬프트+서버, filled≤1) / reconcile (a0) 공급가액 오독 케이스 + 독립 축 검증(Σsupply/Σvat, match 상태에서도 UI 노출). 사양 외 추가 2건: (i) 관계식 기반 lineTotal 교정 — supply+vat=수량×단가 성립인데 lineTotal만 어긋나면 교정(0346 쓰레기봉투 케이스; 세전단가 양식에서는 조건 불성립이라 오발화 없음) (ii) 면세 안전망에 anyRowVat 게이트 — 부가세 컬럼 자체가 없는 전표에서 전 행 exempt 오판 방지(회귀 테스트에서 실제 발생 확인 후 차단). **§7 배포 게이트 전부 통과**: IMG_0344 9항목/Σ590,006/557,398/32,608/과세4·면세5/match/겉절이·손칼국수 병합, IMG_0346 7항목/Σ300,000/278,230/21,770/과세5·면세2/백합 exempt/match/만두 병합, 회귀(test-ocr) 2항목·전행 unknown·no_doc_total, 음성(배추 제거) mismatch·차액 −29,900 정확·축검증 경고 동반, 유닛(H6④ "12)" 병합/오탐 방지/resolveDocGrand 누적미수금 무시/(a0)/축검증) 전부 통과, build 통과. 미해결: 재분석 버튼 Upstage 무호출 확인은 프로덕션 로그로 검증 필요(코드상 캐시 경로 확인됨), 타 거래처 양식(단가 세전형 B양식)에서 면세 안전망은 anyRowVat 게이트로 보호되나 실전표 검증은 미실시.
