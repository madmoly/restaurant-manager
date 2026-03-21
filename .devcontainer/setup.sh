#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Restaurant Manager — Codespaces 초기화"

# pnpm 설치
npm install -g pnpm@10.4.1

# MySQL 실행 (Docker-in-Docker)
echo "🐬 MySQL 시작..."
docker run -d --name rm-mysql \
  -e MYSQL_ROOT_PASSWORD=rootpass \
  -e MYSQL_DATABASE=restaurant_manager \
  -e MYSQL_USER=rmuser \
  -e MYSQL_PASSWORD=rmpass \
  -p 3306:3306 \
  mysql:8.0 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci \
  --default-authentication-plugin=mysql_native_password

# .env 생성
if [ ! -f .env ]; then
  cp .env.example .env
  JWT_SECRET=$(openssl rand -base64 32)
  sed -i "s|CHANGE_ME_GENERATE_RANDOM_SECRET|${JWT_SECRET}|g" .env
  sed -i "s|DATABASE_URL=.*|DATABASE_URL=mysql://rmuser:rmpass@127.0.0.1:3306/restaurant_manager|g" .env
fi

# 의존성 설치
echo "📦 의존성 설치..."
pnpm install

# MySQL 준비 대기
echo "⏳ MySQL 준비 대기..."
for i in $(seq 1 30); do
  if docker exec rm-mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
    break
  fi
  sleep 2
done

# DB 마이그레이션
echo "🗄️ DB 마이그레이션..."
pnpm run db:push

echo ""
echo "✅ 초기화 완료!"
echo "👉 터미널에서 실행: pnpm dev"
echo "👉 브라우저 자동 오픈: 포트 3000"
