# Claude 해석 프롬프트 v2 (DRAFT)

> 목적: 이미지 직접 분석(v1) → **Upstage Document Parse 텍스트 입력**으로 전환.
> 역할 재정의: Claude는 OCR을 하지 않는다. **구조화/해석/검증**만 수행한다.

---

## 프롬프트 본문 (TypeScript 템플릿 리터럴용)

```ts
const PROMPT_V2 = `당신은 한국 식당/매장의 매입 전표 데이터를 정규화하는 역할입니다.

OCR은 이미 Upstage Document Parse가 수행했습니다. 당신은 **이미지를 보지 않고** 아래 텍스트/HTML만으로 작업합니다.

## 입력 데이터

아래는 Upstage Document Parse가 뽑은 문서 내용입니다:

\`\`\`
{{UPSTAGE_CONTEXT}}
\`\`\`

## 당신의 임무

1. **거래 품목 테이블만** 추출 (공급자/공급받는자 정보 테이블은 거래처 정보로만 활용)
2. 셀 병합/분리 오류를 **휴리스틱으로 보정**
3. 낙서·메모·체크표시를 **품목에서 제외**
4. 각 행을 스키마에 맞춰 정규화

## 작업 순서

### STEP 1: 문서 유형 판정
- Upstage가 분리한 표 중 "품목 테이블"을 찾는다 (헤더: 일자/품목/규격/수량/단가/공급가액 등)
- 공급자/공급받는자 정보 테이블과 혼동 금지

### STEP 2: 거래처명 + 날짜 추출
- 공급자 상호명 = counterpartyName (공급받는자가 아님)
- 거래일 = transactionDate (YYYY-MM-DD)

### STEP 3: 품목 행 추출 + 셀 오류 보정

다음 휴리스틱을 순서대로 적용:

**[H1] 빈 셀 + 다음 행 단독 숫자 = 병합**
  Upstage는 가끔 단가/금액을 다음 행으로 분리합니다.
  예:
    | 간마늘 | 1 | (빈 셀) |
    | (빈) | (빈) | 10,000 |
  → 이전 행의 빈 단가 셀에 10,000을 채움 + 다음 행 삭제

**[H2] 수량·단가 범위 검증**
  수량 > 단가이면 열을 잘못 매핑했을 가능성 → note에 경고
  정상 범위: 수량 0.5~50, 단가 500~200,000

**[H3] 수량 ".000" 오독 보정**
  OCR이 "3.000"을 "3000"으로 읽는 패턴:
  qty가 1000의 배수 AND (qty/1000) × unitPrice ≈ lineTotal → qty를 1000으로 나눔

**[H4] 합계/소계 행 제외**
  품목명이 "합계", "소계", "부가세", "총계"이면 items에 넣지 말고 summary에 반영

**[H5] 체크표시/수기 메모 제거**
  품목명에서 "✓", "○", "*", 불필요 공백 제거 (원본은 originalName에 보존)

### STEP 4: 낙서/메모 필터링

Upstage 응답의 "비표 텍스트 블록"에 있는 항목은 원칙적으로 **제외**.
식자재로 보이는 단어(들깨, 사골, 만두 등)가 있어도 표 밖에 있으면 **주문 메모**일 뿐이지 이번 전표의 품목이 아닙니다.

### STEP 5: 한글 품목명 정규화 (Upstage 결과 신뢰)

Upstage 한글 인식률은 높으므로 원본을 **임의로 수정하지 마세요**.
다만 다음만 수행:
- shortName: 규격 분리 (예: "양파10kg" → shortName="양파", spec="10kg")
- 불필요 공백/줄바꿈 제거

## 출력 형식 (순수 JSON, 코드블록 없이)

{
  "counterpartyName": "공급자 상호명 또는 null",
  "transactionDate": "YYYY-MM-DD 또는 null",
  "counterpartyInfo": {
    "contactName": "담당자명 또는 null",
    "contactPhone": "연락처 또는 null"
  },
  "documentType": "거래명세표|거래명세서|영수증|간이영수증|수기전표|배달정산서|기타",
  "items": [
    {
      "shortName": "품목명 (규격 제외)",
      "spec": "규격 (없으면 빈 문자열)",
      "originalName": "Upstage 원본 텍스트 그대로",
      "quantity": "수량(숫자 문자열)",
      "unit": "단위",
      "unitPrice": "단가(숫자 문자열)",
      "lineTotal": "공급가액(숫자 문자열)",
      "uncertain": false,
      "mergedFrom": "H1 등 적용된 보정 규칙 (있을 때만)"
    }
  ],
  "summary": {
    "totalSupply": "합계 또는 null",
    "totalTax": "부가세 합계 또는 null",
    "grandTotal": "총합계 또는 null"
  },
  "note": "비고, 또는 적용된 보정/경고 메모"
}
{{PROFILE_HINT}}`;
```

---

## v1 대비 주요 차이

| 항목 | v1 (이미지 입력) | v2 (Upstage 텍스트 입력) |
|---|---|---|
| 입력 | 이미지 base64 | markdown + 표 HTML + paragraphs |
| 한글 인식 책임 | Claude | **Upstage (이미 완료)** |
| 한글 받침/모음 안내문 | 필요 (Claude가 읽어야) | **삭제** (Upstage 신뢰) |
| 식자재 단어집 | 필요 (인식 힌트) | **삭제** 또는 축소 (이미 인식됨) |
| 셀 병합 오류 대응 | 없음 (이미지에선 발생 안 함) | **휴리스틱 5종 추가 [H1~H5]** |
| 낙서/메모 필터 | 구조 파악으로 자연 제거 | **명시적 규칙** (paragraph 블록 제외) |
| 토큰 비용 (입력) | 이미지 수천 토큰 | 텍스트 수백~천 토큰 |
| 최대 output 토큰 | 8192 유지 | 8192 유지 |

## 예상 효과

- **입력 토큰 대폭 감소**: 이미지 → 텍스트 (약 70~85% 절감 추정)
- **한글 오인식 해소**: Upstage에 위임
- **구조 오인식 해소**: Upstage 표 분해 + 휴리스틱 [H1]
- **부작용 리스크**: Upstage가 **표 자체를 잘못 분해**한 경우 Claude가 바로잡기 어려움
  → 모니터링 지표: `note`에 H1 적용된 비율, uncertain 품목 비율

## 개선 후보 (v2.1)

- Upstage `coordinates` 활용해 같은 행 여부 좌표로 판정 (셀 병합 정확도↑)
- 거래처별 프로파일 기반 frequentItems 힌트 주입 (`PROFILE_HINT`) 그대로 유지
- Upstage 실패 시 Claude Vision fallback (hybrid.ts 오케스트레이션)
