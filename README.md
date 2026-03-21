# 🍽️ Restaurant Manager

자영업 식당 운영 관리 시스템 — 매출, 인건비, 고정비, 스케줄, 전자계약, 수익성 분석

---

## 🚀 바로 실행하기

### 방법 1: GitHub Codespaces (개발 — 무료, 3분)

> 브라우저에서 바로 개발환경 + 앱 실행. 설치할 것 없음.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/YOUR_USERNAME/restaurant-manager?quickstart=1)

1. 위 버튼 클릭 (또는 리포 페이지에서 **Code → Codespaces → Create**)
2. 초기화 자동 실행 (MySQL + 의존성 + 마이그레이션 ~2분)
3. 터미널에서 `pnpm dev` 입력
4. 포트 3000 알림 → **Open in Browser** 클릭
5. 끝. 브라우저에서 앱 사용 가능

### 방법 2: Railway (프로덕션 배포 — $5/월, 5분)

> git push 할 때마다 자동 배포. 고정 URL 발급.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/restaurant-manager?referralCode=)

1. 위 버튼 클릭 (또는 railway.app에서 GitHub 리포 연결)
2. Railway 대시보드에서 **+ New → Database → MySQL** 추가
3. 앱 서비스 → **Variables** 탭에서 설정:
   - `DATABASE_URL` — MySQL Connect 탭에서 복사
   - `JWT_SECRET` — 터미널에서 `openssl rand -base64 32`
   - `NODE_ENV` — `production`
4. 자동 배포 완료 → 발급된 URL로 접속

### 방법 3: 로컬 실행 (Docker Desktop 필요)

```bash
git clone git@github.com:YOUR_USERNAME/restaurant-manager.git
cd restaurant-manager
chmod +x setup.sh && ./setup.sh
pnpm dev
# → http://localhost:3000
```

---

## 📌 GitHub 리포 최초 생성 (한 번만)

```bash
# gh CLI 필요: brew install gh && gh auth login
cd restaurant-manager
chmod +x deploy.sh && ./deploy.sh
# → 옵션 1 선택 (GitHub 리포 생성)
```

생성 후 README.md의 `YOUR_USERNAME`을 본인 GitHub 아이디로 변경.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React 19, Vite 7, TailwindCSS 4, shadcn/ui |
| Backend | Express, tRPC, Drizzle ORM |
| Database | MySQL 8.0 |
| Auth | JWT (jose) + bcrypt |
| PDF | Puppeteer + Chromium |
| CI/CD | GitHub Actions → GHCR |
| Deploy | Railway / Docker / Codespaces |

## 스크립트

| 명령어 | 설명 |
|---|---|
| `pnpm dev` | 개발 서버 (HMR) |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm start` | 프로덕션 실행 |
| `pnpm check` | TypeScript 타입 체크 |
| `pnpm test` | 테스트 |
| `pnpm db:push` | DB 마이그레이션 |

## 상세 문서

- [DEPLOYMENT.md](./DEPLOYMENT.md) — 배포 가이드, Manus 종속성 제거 로드맵, 브랜치 전략
