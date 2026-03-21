#!/usr/bin/env bash
# =============================================================================
# GitHub 리포 생성 + Railway 원클릭 배포 가이드
# Usage: chmod +x deploy.sh && ./deploy.sh
#
# 사전 조건: gh CLI 설치 (https://cli.github.com)
#            railway CLI 설치 (npm i -g @railway/cli)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}ℹ️  $1${NC}"; }

echo ""
echo "═══════════════════════════════════════════"
echo "  Restaurant Manager — 배포 자동화"
echo "═══════════════════════════════════════════"
echo ""

# -----------------------------------------------
# Mode 선택
# -----------------------------------------------
echo "배포 방법을 선택하세요:"
echo "  1) GitHub 리포 생성만 (로컬 개발)"
echo "  2) GitHub + Railway 배포 (프로덕션)"
echo ""
read -p "선택 [1/2]: " MODE
MODE=${MODE:-1}

# -----------------------------------------------
# 1. GitHub 리포 생성
# -----------------------------------------------
echo ""
echo "━━━ Step 1: GitHub 리포 ━━━"

if ! command -v gh >/dev/null 2>&1; then
  err "GitHub CLI 필요: https://cli.github.com 설치 후 'gh auth login' 실행"
fi

# git 초기화
if [ ! -d .git ]; then
  git init
  log "Git 초기화"
fi

# .manus 디렉토리 정리 (있을 경우)
if [ -d .manus ]; then
  rm -rf .manus
  log ".manus 디렉토리 제거"
fi
if [ -d client/public/__manus__ ]; then
  rm -rf client/public/__manus__
  log "Manus 디버그 콜렉터 제거"
fi

# 리모트 체크
if git remote get-url origin >/dev/null 2>&1; then
  REMOTE_URL=$(git remote get-url origin)
  warn "이미 리모트 설정됨: ${REMOTE_URL}"
  read -p "계속 진행? [y/N]: " CONTINUE
  [[ "$CONTINUE" =~ ^[Yy]$ ]] || exit 0
else
  read -p "리포 이름 (기본: restaurant-manager): " REPO_NAME
  REPO_NAME=${REPO_NAME:-restaurant-manager}

  read -p "비공개 리포? [Y/n]: " PRIVATE
  PRIVATE=${PRIVATE:-Y}

  if [[ "$PRIVATE" =~ ^[Yy]$ ]]; then
    gh repo create "$REPO_NAME" --private --source=. --remote=origin
  else
    gh repo create "$REPO_NAME" --public --source=. --remote=origin
  fi
  log "GitHub 리포 생성: ${REPO_NAME}"
fi

# 초기 커밋 + 푸시
git add .
git commit -m "chore: initial commit - restaurant manager v1.0.0" 2>/dev/null || warn "변경사항 없음 (이미 커밋됨)"
git branch -M main
git push -u origin main 2>/dev/null || git push origin main
log "main 브랜치 푸시 완료"

# develop 브랜치
if ! git rev-parse --verify develop >/dev/null 2>&1; then
  git checkout -b develop
  git push -u origin develop
  git checkout main
  log "develop 브랜치 생성"
fi

REPO_URL=$(gh repo view --json url -q '.url' 2>/dev/null || echo "")
echo ""
log "GitHub 리포 준비 완료"
if [ -n "$REPO_URL" ]; then
  info "리포 URL: ${REPO_URL}"
fi

# -----------------------------------------------
# 2. Railway 배포 (선택)
# -----------------------------------------------
if [ "$MODE" == "2" ]; then
  echo ""
  echo "━━━ Step 2: Railway 배포 ━━━"

  if ! command -v railway >/dev/null 2>&1; then
    echo ""
    info "Railway CLI 설치 중..."
    npm install -g @railway/cli
  fi

  # Railway 로그인 확인
  if ! railway whoami >/dev/null 2>&1; then
    echo ""
    info "Railway 로그인이 필요합니다."
    railway login
  fi

  # 프로젝트 생성
  echo ""
  info "Railway 프로젝트를 생성합니다..."
  railway init

  # MySQL 추가 안내
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "${YELLOW}⚠️  Railway 대시보드에서 수동 설정 필요:${NC}"
  echo ""
  echo "  1. https://railway.app/dashboard 에서 프로젝트 열기"
  echo "  2. '+ New' → 'Database' → 'MySQL' 추가"
  echo "  3. MySQL 서비스 클릭 → 'Connect' 탭"
  echo "     → DATABASE_URL 복사"
  echo "  4. 앱 서비스 클릭 → 'Variables' 탭에서 설정:"
  echo ""
  echo "     DATABASE_URL = (위에서 복사한 값)"
  echo "     JWT_SECRET   = (아무 랜덤 문자열)"
  echo "     NODE_ENV     = production"
  echo "     PORT         = 3000"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  read -p "환경변수 설정 완료 후 Enter를 누르세요... "

  # 배포
  echo ""
  info "배포 시작..."
  railway up --detach

  echo ""
  RAILWAY_URL=$(railway domain 2>/dev/null || echo "")
  if [ -n "$RAILWAY_URL" ]; then
    log "배포 완료!"
    echo ""
    echo "═══════════════════════════════════════════"
    echo -e "  ${GREEN}🚀 앱 URL: https://${RAILWAY_URL}${NC}"
    echo "═══════════════════════════════════════════"
  else
    log "배포 요청 완료. Railway 대시보드에서 URL 확인."
  fi
fi

# -----------------------------------------------
# 완료 요약
# -----------------------------------------------
echo ""
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}✅ 완료!${NC}"
echo ""
if [ -n "${REPO_URL:-}" ]; then
  echo -e "  GitHub:  ${CYAN}${REPO_URL}${NC}"
fi
echo ""
echo "  다음 단계:"
if [ "$MODE" == "1" ]; then
  echo "    로컬 개발: ./setup.sh"
  echo "    프로덕션:  ./deploy.sh (옵션 2 선택)"
else
  echo "    Railway 대시보드에서 배포 상태 확인"
  echo "    이후 개발: git push origin main → 자동 배포"
fi
echo "═══════════════════════════════════════════"
echo ""
