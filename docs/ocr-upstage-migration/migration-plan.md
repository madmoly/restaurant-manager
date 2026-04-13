# OCR 엔진 전환 계획 — Claude Vision → Upstage Hybrid

> 작성: 2026-04-14
> 상태: 설계 초안 (draft). 코드 통합·배포 미수행.
> 관련 파일:
> - `upstage-adapter.ts` — Upstage API 호출 + Claude용 컨텍스트 구성
> - `claude-prompt-v2.md` — 텍스트 입력 전용 해석 프롬프트
> - `hybrid-orchestrator.ts` — 엔진 토글 + fallback 오케스트레이션

---

## 1. 전환 전제

- **현재 체감 약점**: 한글 품목명 오인식 + 셀/행 구조 오인식. 숫자 인식은 양호.
- **파일럿 결과** (1 샘플, 거래명세서):
  - 한글: ✅ 완전 해결 (Upstage)
  - 구조: 🟡 표 분해 정상, 단 1 행에서 단가 셀 분리 (Claude 휴리스틱으로 정정 가능)
  - 응답시간: 3~4초 / 페이지
  - 회전(EXIF orientation=upper-right) 자동 보정됨
- **비용 변화**:
  - 현재: Claude Sonnet Vision, 이미지 토큰(수천) 한 번
  - 변경 후: Upstage $0.01/page + Claude Sonnet 텍스트 토큰(수백~천)

## 2. 역할 분담

| 단계 | 담당 엔진 |
|---|---|
| 파일 수신·EXIF 보정 | 서버 (기존 유지) |
| 이미지 전처리 (sharp) | 선택적 유지 — Upstage는 저해상도에도 강함, 단 CPU 비용 절감 효과 있으면 유지 |
| 텍스트 추출 + 표 구조 분해 | **Upstage Document Parse** |
| 거래처 매칭·휴리스틱·정규화 | **Claude Sonnet (텍스트 입력)** |
| 합계 크로스체크 + .000 보정 | 서버 `validateAndEnrichItems` (기존 유지) |
| 학습 데이터 축적 | 서버 `ocr_corrections` (기존 유지) |

## 3. 통합 단계 (체크리스트)

### Phase 0 — 파일럿 (완료)
- [x] Upstage 계정 + API Key 발급
- [x] 샘플 1장 파라미터 변주 호출 (force/auto/coordinates)
- [x] 응답 구조 분석 (elements: paragraph + table, content: markdown/html/text)
- [x] 셀 병합 오류 패턴 식별

### Phase 1 — 확장 검증 (사용자 액션 필요)
- [ ] 실패 샘플 5~10장 추가 업로드 → `test-ocr-results/` 배치
- [ ] 각 샘플 Upstage 호출 → JSON 수집
- [ ] 기존 Claude Vision 출력과 품목명/수량/단가/합계 정확도 비교
- [ ] 통과 기준: 품목명 한글 정확도 기존 대비 +20%p 이상
- **완료 조건**: `test-ocr-results/accuracy-summary.md` 생성

### Phase 2 — 코드 통합
- [ ] `docs/ocr-upstage-migration/` 초안 3개 파일 → `server/ocr-engines/`로 이동
- [ ] `server/ocr.ts` 내 helper 함수 3종 export 처리:
  - `getAnthropicClient`, `buildProfileHint`, `getOcrProfile`
  - `validateAndEnrichItems`, `matchCounterpartyItems`
  - `loadImageBase64Raw`, `extractText`, `safeParseJson`
- [ ] `/extract-purchase` 엔드포인트 리팩터:
  ```ts
  const output = await runHybridOcr({ filePath, restaurantId, counterpartyId }, deps);
  const items = validateAndEnrichItems(output.rawJson.items, output.rawJson.summary);
  const matched = await matchCounterpartyItems(restaurantId, counterpartyId, items);
  ```
- [ ] 로깅: `output.engine`, `output.upstage.elapsedMs`, `output.claude.*` → `api_usage_logs` 확장
- **완료 조건**: `pnpm run build` 통과, 기존 샘플 회귀 테스트 1장 통과

### Phase 3 — 환경 변수 + 롤백 루트
- [ ] `.env.example`에 `OCR_ENGINE=upstage` 추가
- [ ] `UPSTAGE_API_KEY` Railway 환경변수 등록 (승인 필요 — 정지 조건 4)
- [ ] 기본값 `OCR_ENGINE=claude_vision`으로 배포 → 문제 없음 확인 후 `upstage`로 스위치
- **롤백 방법**: Railway 환경변수 `OCR_ENGINE=claude_vision`으로 재설정 (코드 변경 없음)

### Phase 4 — 부분 롤아웃
- [ ] 1개 매장만 `upstage` 모드 2주 운영
- [ ] 지표:
  - Claude 입력 토큰 감소율
  - `ocr_corrections` 발생률 변화
  - 응답시간 변화 (end-to-end)
- **통과 기준**: 수정 발생률 30% 이상 감소

### Phase 5 — 전면 전환 + 레거시 정리
- [ ] 모든 매장 `OCR_ENGINE=upstage`
- [ ] 이미지 전처리 sharp 파이프라인 스펙 재검토 (Upstage는 저해상도 강함 → grayscale/sharpen 불필요 여부)
- [ ] Claude Vision 경로는 fallback으로만 유지

## 4. 리스크 & 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| Upstage 장애/응답 지연 | OCR 요청 실패 | `hybrid.ts`에 Claude Vision fallback 내장 (`OCR_ENGINE=claude_vision` 토글) |
| Upstage 표 분해 자체 오류 | 품목 누락 | Claude 휴리스틱 [H1~H5]로 1차 정정, 실패분은 `ocr_corrections`로 학습 |
| API 2개 관리 부담 | 운영 복잡도 ↑ | 로깅 표준화 + 엔진별 분리 지표 |
| 비용 증가 | $0.01/page 추가 | Claude 입력 토큰 절감으로 상쇄 예상. Phase 4에서 실측 |
| Upstage `auto` vs `force` 차이 | 인쇄 텍스트에서 OCR 누락 가능성 | 기본 `auto`, 실패 시 `force`로 재시도 루트 추가 고려 |

## 5. 정지 조건 (승인 필요 지점)

- **Phase 3 Railway 환경변수 추가**: `UPSTAGE_API_KEY` 등록 시 사용자 승인
- **Phase 5 전면 전환**: Phase 4 지표 확인 후 사용자 승인 → 기본값 변경 배포

## 6. 지표 (운영 후 모니터링)

모두 `api_usage_logs` 확장으로 수집:
- `engine`: upstage | claude_vision
- `upstage_ms`, `claude_ms`, `total_ms`
- `claude_input_tokens`, `claude_output_tokens`
- `fallback_used`: Upstage 실패 fallback 발생 여부

쿼리 예시 (수정 발생률 비교):
```sql
SELECT
  DATE(a.createdAt) AS day,
  a.endpoint,
  JSON_EXTRACT(a.extra, '$.engine') AS engine,
  COUNT(*) AS calls,
  SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) AS corrections,
  ROUND(100.0 * SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) AS correction_rate_pct
FROM api_usage_logs a
LEFT JOIN ocr_corrections c ON c.apiUsageLogId = a.id
WHERE a.endpoint = 'extract-purchase'
  AND a.createdAt >= NOW() - INTERVAL 14 DAY
GROUP BY day, engine
ORDER BY day DESC, engine;
```
(※ `ocr_corrections.apiUsageLogId` 외래키는 추가 필요할 수 있음 — 현재 스키마 확인 필요.)
