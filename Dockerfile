# =============================================================================
# restaurant-manager | Multi-stage Docker build
# =============================================================================

# --- Stage 1: Install dependencies ---
FROM node:20-slim AS deps
WORKDIR /app

# pnpm 설치
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod=false

# --- Stage 2: Build ---
FROM node:20-slim AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Manus dev 전용 플러그인 제거 (빌드 시 무시)
ENV NODE_ENV=production
RUN pnpm run build

# --- Stage 3: Production ---
FROM node:20-slim AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Chromium dependencies for PDF generation (puppeteer-core)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Production deps only
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile --prod

# Copy build output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle

# Non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000
ENV PORT=3000

CMD ["node", "dist/index.js"]
