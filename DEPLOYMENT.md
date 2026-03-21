# Restaurant Manager — 개발·배포 가이드

## 아키텍처

```
Client (React 19 + Vite 7)
  ↕ tRPC
Server (Express + tRPC)
  ↕ Drizzle ORM
MySQL 8.0
```

## 로컬 개발 환경 설정

### 1. 사전 조건
- Node.js 20+
- pnpm 10.4+
- Docker (MySQL 용)

### 2. 초기 설정

```bash
# 리포 클론
git clone git@github.com:<your-org>/restaurant-manager.git
cd restaurant-manager

# 환경변수 설정
cp .env.example .env
# .env 파일을 열어 JWT_SECRET 등 필수값 설정

# MySQL 실행 (Docker)
docker compose up -d db

# 의존성 설치
pnpm install

# DB 마이그레이션
pnpm run db:push

# 개발 서버 실행
pnpm run dev
```

### 3. 주요 스크립트

| 명령어 | 설명 |
|---|---|
| `pnpm dev` | 개발 서버 (HMR) |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm start` | 프로덕션 실행 |
| `pnpm check` | TypeScript 타입 체크 |
| `pnpm test` | 테스트 실행 |
| `pnpm db:push` | DB 마이그레이션 |

## 배포

### Option A: Railway (추천)

1. [railway.app](https://railway.app)에서 GitHub 리포 연결
2. MySQL 플러그인 추가 → `DATABASE_URL` 자동 주입
3. 환경변수 설정 (Settings → Variables):
   - `JWT_SECRET` (필수)
   - `PORT=3000`
   - `NODE_ENV=production`
4. Build Command: `pnpm install && pnpm build`
5. Start Command: `pnpm start`

### Option B: Docker (VPS)

```bash
# 이미지 빌드
docker compose build app

# 전체 실행 (MySQL + App)
docker compose up -d

# 또는 GHCR에서 pull
docker pull ghcr.io/<your-org>/restaurant-manager:latest
```

### Option C: Fly.io

```bash
fly launch
fly secrets set JWT_SECRET=xxx DATABASE_URL=xxx
fly deploy
```

## Manus 종속성 제거 로드맵

현재 Manus 플랫폼에 종속된 모듈과 제거 순서:

### Phase 1: 즉시 제거 (기능 영향 없음)
- [ ] `vite-plugin-manus-runtime` — vite.config.ts에서 제거
- [ ] `client/public/__manus__/` — 디버그 콜렉터 디렉토리 삭제
- [ ] `.manus/` — DB 쿼리 로그 디렉토리 삭제
- [ ] `vite.config.ts` allowedHosts에서 manus 도메인 제거
- [ ] `vite.config.ts` vitePluginManusDebugCollector 함수 제거

### Phase 2: Storage 전환 (S3 직접 연결)
- [ ] `server/storage.ts` → S3 PutObject/GetObject 직접 호출로 교체
- [ ] 환경변수: `BUILT_IN_FORGE_*` → `AWS_*` + `S3_BUCKET_NAME`
- [ ] 업로드 엔드포인트 테스트

### Phase 3: Auth 독립
- [ ] `server/_core/oauth.ts` → 자체 로그인 (email+password, bcrypt 이미 있음)
- [ ] `server/_core/sdk.ts` → OAuthService 제거, JWT 발급/검증만 유지
- [ ] 로그인 페이지 UI 수정 (client/src/pages/Login.tsx)

### Phase 4: LLM/Image Gen (선택)
- [ ] `server/_core/llm.ts` → OPENAI_API_KEY + OPENAI_BASE_URL 환경변수로 전환
- [ ] `server/_core/imageGeneration.ts` → 필요 시 DALL-E API로 교체

## 브랜치 전략

```
main          ← 프로덕션 배포 (태그 기반)
  └─ develop  ← 개발 통합 브랜치
       └─ feature/*  ← 기능 개발
       └─ fix/*      ← 버그 수정
```

## 버전 관리

시맨틱 버저닝 사용:
```bash
# 기능 추가
git tag v1.1.0 && git push --tags

# 버그 수정
git tag v1.0.1 && git push --tags
```
