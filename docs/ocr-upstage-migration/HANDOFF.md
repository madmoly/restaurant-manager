# HANDOFF — OCR Hybrid 전환 (Cowork → Claude Code)

> 작성: 2026-04-14 (Cowork에서 설계 완료, Code에서 통합·빌드 인계)
> 작업 위치: `~/Documents/Claude/Projects/restaurant-manager`
> 상태: **draft 3개 작성 완료, 미통합. 기존 코드 0 수정. 빌드 영향 0.**

---

## 0. Code 세션 시작 시 상태 확인 (필수)

```bash
cd ~/Documents/Claude/Projects/restaurant-manager

# 레포 위치 확인
git rev-parse --show-toplevel
# → /Users/.../Documents/Claude/Projects/restaurant-manager 이어야 함

# 원격 동기화 상태
git status -sb
git fetch
git log --oneline @{u}..   # 내가 밀 커밋
git log --oneline ..@{u}   # 원격에만 있는 커밋

# lock 잔존 확인
ls -la .git/index.lock .git/HEAD.lock 2>/dev/null

# 이번 작업 draft 확인
ls -la docs/ocr-upstage-migration/
```

**예상 상태**:
- `docs/ocr-upstage-migration/` 폴더에 5개 파일 (upstage-adapter.ts, hybrid-orchestrator.ts, claude-prompt-v2.md, migration-plan.md, HANDOFF.md)
- `.gitignore`에 `test-ocr-results/` 추가됨
- `server/ocr.ts` 미수정
- `test-ocr-results/result0{1,2,3}.json`은 gitignored (커밋 금지)

---

## 1. 작업 목표

`server/ocr.ts`의 Claude Vision 단독 OCR을 **Upstage Document Parse + Claude Sonnet 텍스트 해석 하이브리드**로 전환.

**체감 약점 해소**: 한글 인식 약함 + 표 구조 인식 약함 (숫자는 양호).

**롤백 루트**: 환경변수 `OCR_ENGINE=claude_vision`로 언제든 기존 경로 복귀.

---

## 2. 통합 단계 (Phase 2)

### 2-1. 파일 이동 (draft → 운영 위치)

```bash
mkdir -p server/ocr-engines
git mv docs/ocr-upstage-migration/upstage-adapter.ts   server/ocr-engines/upstage.ts
git mv docs/ocr-upstage-migration/hybrid-orchestrator.ts server/ocr-engines/hybrid.ts
```

이동 후 `upstage.ts` / `hybrid.ts`에서 import 경로 확인:
- `hybrid.ts` 내 `"./upstage-adapter"` → `"./upstage"`로 수정

완료 조건: `ls server/ocr-engines/` → `upstage.ts hybrid.ts` 2개 존재

### 2-2. `server/ocr.ts`에서 헬퍼 export

다음 8개 심볼을 `export` 접두사로 변환:

| 라인 (현재) | 심볼 |
|---|---|
| 143 | `getAnthropicClient` |
| 150 | `loadImageBase64Raw` |
| 179 | `parseAIJson` |
| 212 | `extractText` |
| 230 | `validateAndEnrichItems` |
| 365 | `matchCounterpartyItems` |
| 609 | `getOcrProfile` |
| 699 | `buildProfileHint` |

주의: 이 함수들은 내부에서 서로 호출한다 (예: `getOcrProfile` → `db`). 외부 export만 추가하고 내부 호출부는 건드리지 말 것.

완료 조건: `grep -c "^export function\|^export async function" server/ocr.ts` → 기존보다 8 증가

### 2-3. Prompt v2 템플릿을 코드로 구현

`server/ocr-engines/prompts.ts` 신규 생성. `docs/ocr-upstage-migration/claude-prompt-v2.md`의 본문을 TypeScript 템플릿 리터럴로 옮긴다.

```ts
// server/ocr-engines/prompts.ts
export function promptV2(upstageContext: string, profileHint: string): string {
  return `당신은 한국 식당/매장의 매입 전표 데이터를 정규화하는 역할입니다.
...
\`\`\`
${upstageContext}
\`\`\`
...
${profileHint}`;
}

export function promptV1ImageFallback(profileHint: string): string {
  // server/ocr.ts 라인 820~940의 기존 프롬프트를 그대로 옮긴다
  return `이 이미지는 한국 식당/매장의 매입 전표입니다.
...${profileHint}`;
}
```

완료 조건: `server/ocr-engines/prompts.ts` 존재, `promptV2` / `promptV1ImageFallback` 2개 export

### 2-4. `/extract-purchase` 엔드포인트 분기 삽입

`server/ocr.ts` 라인 729~ 의 `ocrRouter.post("/extract-purchase", ...)` 내부에서 Claude Vision 호출부(라인 815 `anthropic.messages.create`)를 `runHybridOcr` 호출로 교체:

```ts
import { runHybridOcr } from "./ocr-engines/hybrid";
import { promptV2, promptV1ImageFallback } from "./ocr-engines/prompts";

// 기존 (라인 815~):
// const response = await anthropic.messages.create({ model, max_tokens, messages: [...] });
// const responseText = extractText(response);
// const parsed = parseAIJson(responseText);

// 신규:
const hybridOut = await runHybridOcr(
  { filePath, restaurantId: Number(restaurantId) || undefined, counterpartyId: clientCpId },
  {
    anthropic,
    buildProfileHint,
    getOcrProfile,
    promptV2Template: promptV2,
    promptV1ImageFallback,
    loadImageBase64Raw,
    extractText,
    parseAIJson,
  }
);

const parsed = hybridOut.rawJson;
// 이후 기존 validateAndEnrichItems / matchCounterpartyItems 그대로
```

`logOcrApiUsage` 호출에 `engine`, `upstage_ms` 필드 추가 (스키마 확장 필요 여부는 2-5에서 결정).

완료 조건: `pnpm run build` 통과

### 2-5. 환경변수 추가

`.env`에 이미 `UPSTAGE_API_KEY` 존재 확인:
```bash
grep -c "UPSTAGE_API_KEY" .env
# → 1
```

`.env.example`에 플레이스홀더 추가:
```
UPSTAGE_API_KEY=
OCR_ENGINE=claude_vision  # 기본값. Phase 4에서 upstage로 스위치
```

**Railway 환경변수 추가는 정지 조건 4 — 여기서 멈추고 사용자 승인 받기.**

### 2-6. 로컬 회귀 테스트

```bash
# 기존 모드 (Claude Vision)로 빌드만 확인
OCR_ENGINE=claude_vision pnpm run build

# 타입 체크
./node_modules/.bin/tsc --noEmit
```

완료 조건: 0 에러

---

## 3. 배포 전 5항 요약 (정지 조건)

`git push origin main` 직전 사용자에게 보고:

1. **변경 파일 목록**:
   ```
   git diff --stat
   # 예상:
   # server/ocr-engines/upstage.ts  | +XXX
   # server/ocr-engines/hybrid.ts   | +XXX
   # server/ocr-engines/prompts.ts  | +XXX
   # server/ocr.ts                  | +XX / -XX  (export 추가 + 엔드포인트 패치)
   # .env.example                   | +2
   # docs/ocr-upstage-migration/... | draft 이동됨
   ```

2. **변경 의도**:
   - 한글·표 구조 OCR 약점 해소 목적으로 Upstage Document Parse 도입
   - Claude Vision 경로는 fallback으로 보존 (`OCR_ENGINE=claude_vision`)

3. **영향 범위**: OCR 매입 입력 (`/extract-purchase`)만. DB 마이그레이션 없음. tRPC 라우터 무변경. 권한 모델 무변경.

4. **리스크 + 롤백**:
   - Upstage 장애 시 자동 fallback 내장
   - 문제 발생 시 Railway 환경변수 `OCR_ENGINE=claude_vision`으로 즉시 복구
   - 완전 롤백은 이전 커밋 revert

5. **빌드 결과**: `pnpm run build` 통과 (로그 첨부)

---

## 4. Git 커밋 메시지 초안

한글 커밋 메시지는 CLAUDE.md §13에 따라 임시 파일 경유:

```bash
cat > .commitmsg <<'EOF'
OCR: Upstage Document Parse + Claude 텍스트 해석 하이브리드 도입

- 체감 약점(한글 품목명/표 구조 인식)을 Upstage Document Parse로 해소
- Claude Sonnet 역할을 구조 해석·거래처 매칭·검증으로 재배치 (이미지 입력 → 텍스트 입력)
- server/ocr-engines/ 모듈화: upstage.ts, hybrid.ts, prompts.ts
- OCR_ENGINE 환경변수로 엔진 토글 + Upstage 실패 시 Claude Vision 자동 fallback
- 기존 counterparty_ocr_profiles / ocr_corrections 학습 자산 100% 보존

기본값 OCR_ENGINE=claude_vision 유지 (롤백 루트). Railway에서 upstage로 스위치해 전환.
EOF

git add server/ocr-engines .env.example server/ocr.ts docs/ocr-upstage-migration
git commit --file=.commitmsg
```

---

## 5. Claude Code에 붙여넣을 시작 프롬프트

```
restaurant-manager 프로젝트에서 OCR 엔진을 Claude Vision 단독에서 Upstage+Claude 하이브리드로 전환한다.

작업 지시서: docs/ocr-upstage-migration/HANDOFF.md

그대로 §2 통합 단계(2-1 ~ 2-6) 순서대로 실행하고, §3 배포 전 5항 요약까지 준비해라. §2-5의 Railway 환경변수 추가 직전에 멈추고 승인 대기.

자율 실행 허용: 파일 이동, export 추가, 엔드포인트 패치, prompts.ts 작성, pnpm build, tsc 검증.
정지 조건: Railway 환경변수 변경, git push.

시작 전 git status + docs/ocr-upstage-migration/ 파일 목록부터 출력해 상태 확인.
```

---

## 6. 체크리스트 요약

- [ ] 2-1: 파일 이동 (`git mv`) + import 경로 수정
- [ ] 2-2: `server/ocr.ts`에서 헬퍼 8개 `export` 추가
- [ ] 2-3: `server/ocr-engines/prompts.ts` 작성 (v2 + v1 fallback)
- [ ] 2-4: `/extract-purchase` 엔드포인트 `runHybridOcr` 호출로 교체
- [ ] 2-5: `.env.example` 업데이트. **Railway 환경변수는 승인 대기**
- [ ] 2-6: `pnpm run build` + `tsc --noEmit` 통과
- [ ] §3 5항 요약 보고
- [ ] 승인 후 `git push`

완료되면 Phase 4 (1개 매장 부분 롤아웃)는 별도 작업으로 진행.
