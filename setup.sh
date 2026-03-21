#!/usr/bin/env bash
# =============================================================================
# restaurant-manager 원클릭 로컬 세팅
# Usage: chmod +x setup.sh && ./setup.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo ""
echo "═══════════════════════════════════════════"
echo "  Restaurant Manager — 로컬 환경 셋업"
echo "═══════════════════════════════════════════"
echo ""

# -----------------------------------------------
# 1. 사전 조건 체크
# -----------------------------------------------
command -v node >/dev/null 2>&1   || err "Node.js가 필요합니다. https://nodejs.org"
command -v pnpm >/dev/null 2>&1   || err "pnpm이 필요합니다. npm install -g pnpm"
command -v docker >/dev/null 2>&1 || err "Docker가 필요합니다. https://docker.com"

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  err "Node.js 20+ 필요 (현재: $(node -v))"
fi
log "Node $(node -v), pnpm $(pnpm -v), Docker OK"

# -----------------------------------------------
# 2. 환경변수 설정
# -----------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  # JWT_SECRET 자동 생성
  JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|CHANGE_ME_GENERATE_RANDOM_SECRET|${JWT_SECRET}|g" .env
  else
    sed -i "s|CHANGE_ME_GENERATE_RANDOM_SECRET|${JWT_SECRET}|g" .env
  fi
  log ".env 생성 완료 (JWT_SECRET 자동 생성됨)"
else
  warn ".env 이미 존재 — 스킵"
fi

# -----------------------------------------------
# 3. MySQL 실행
# -----------------------------------------------
echo ""
echo "🐬 MySQL 시작 중..."
docker compose up -d db

echo "   MySQL 준비 대기 중..."
RETRIES=30
until docker compose exec db mysqladmin ping -h localhost --silent 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    err "MySQL 시작 실패. 'docker compose logs db' 확인"
  fi
  sleep 2
done
log "MySQL 준비 완료"

# -----------------------------------------------
# 4. 의존성 설치
# -----------------------------------------------
echo ""
echo "📦 의존성 설치 중..."
pnpm install
log "의존성 설치 완료"

# -----------------------------------------------
# 5. DB 마이그레이션
# -----------------------------------------------
echo ""
echo "🗄️  DB 마이그레이션 실행 중..."
pnpm run db:push
log "마이그레이션 완료"

# -----------------------------------------------
# 6. 완료
# -----------------------------------------------
echo ""
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}✅ 셋업 완료!${NC}"
echo ""
echo "  개발 서버 시작:"
echo -e "  ${YELLOW}pnpm dev${NC}"
echo ""
echo "  브라우저에서 열기:"
echo -e "  ${YELLOW}http://localhost:3000${NC}"
echo "═══════════════════════════════════════════"
echo ""
