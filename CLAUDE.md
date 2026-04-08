# 331매장관리 (Restaurant Manager)

> 마지막 갱신: 2026-04-09

## 작업 원칙
- **Single source of truth**: 데이터 = Railway DB, 작업관리 = GitHub Issues, 코드 = origin/main
- **로컬 경로**: `~/Code/restaurant-manager` 1개소만 허용. 다른 위치 clone/worktree 금지
- **로컬 산출물**: `backups/`, `*.sql`, `.env`, scratch 파일 repo 커밋 금지 (.gitignore 강제)
- **로컬 런타임 없음**: dev 서버 안 돌림. 테스트는 Railway 자동 배포 결과로 검증

## 역할 분담 (Cowork ↔ Claude Code)
- **Cowork**: 기획, 설계, 문서 리뷰, 수정안 초안
- **Claude Code**: 빌드, 배포, 테스트, rebase/reset, 대량 파일 조작
- Cowork 샌드박스는 unlink 제약으로 대량 삭제·rebase 불가 → 반드시 Code로 핸드오프

## 배포 전 의무 요약 (5항)
1. 변경 파일
2. 변경 의도
3. 영향 범위
4. 리스크
5. 빌드 결과 (pnpm run build 통과 여부)

## tRPC procedure 레벨
- publicProcedure / protectedProcedure / managerProcedure / ownerProcedure / adminProcedure / masterProcedure
- 스토어 소속 자원 접근 시 `verifyStoreAccess` 필수

## 스택
- React 19 + Vite 7, tRPC v11, Drizzle ORM, MySQL 8
- pnpm, Node (fnm, Apple Silicon arm64)
- 배포: Railway 자동 (main push 트리거)
- 프로덕션: https://restaurant-manager-production-a762.up.railway.app/

## 금지
- 로컬 `todo.md`, 작업 로그 파일 생성 (작업관리는 GitHub Issues에서만)
- DB dump의 repo 커밋
- `.env` 커밋 또는 로컬 장기 보관
- `~/Documents`, `~/Desktop`, `~/iCloud Drive` 하위에 clone (iCloud Drive는 현재 off 상태지만 규칙상 유지)
