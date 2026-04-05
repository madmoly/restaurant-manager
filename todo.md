# Restaurant Manager — 작업 로드맵

> 마지막 갱신: 2026-04-05

## 완료된 작업 (아카이브)

- [x] Phase 0~3: 마누스→채팅 포팅 완료
- [x] 매출/매입/고정비/스케줄/체크리스트/전자계약 기본 기능
- [x] PWA 지원
- [x] 에러 자동 수집 시스템
- [x] 역할 체계 재정의 (owner/supervisor/staff + master/admin 분리)
- [x] 대시보드 역할별 분기 (MasterDashboard, AdminDashboard, ManagerDashboard, EmployeeDashboard)
- [x] 스케줄 시스템 개선 (중복방지, 모바일UX, 상태흐름 재정의)
- [x] 직원관리 (보건증, 소속회사, ID/PW 수정)
- [x] 프로젝트 정리 (레거시 파일 삭제, .gitignore 정비, CLAUDE.md 갱신)
- [x] "매장관리 > 체크리스트관리" → "내 매장 업무관리"로 명칭 변경
- [x] 체크리스트 속성에 반복(daily/weekly/monthly) + repeatDays 구분 추가
- [x] 보건증 만료 도래 시 자동 알림 (server/index.ts 스케줄러, 30일전)
- [x] 소속회사별 인건비 정산 조회 화면 (LaborCostPage + laborCostByCompany API)
- [x] OCR Phase 2: 거래처별 OCR 프로파일 자동 생성/업데이트 + 이동평균 단가 학습
- [x] OCR Phase 2: 사용자 OCR 수정 데이터 축적 + corrections 조회/통계 API
- [x] OCR Phase 3: 동적 프롬프트 주입 (거래처 프로파일 기반 품목/단가 힌트)
- [x] QA/QC 보안 점검 (비활성 계정 로그인 차단, verifyStoreAccess 누락 6건 수정)
- [x] admin 권한 상승 취약점 차단 (users.create/update 역할 제한)
- [x] staff 스케줄 페이지 관리 버튼 노출 버그 수정
- [x] 근무유형 프리셋 설정 UI 개선 (카드형 인라인 편집, Switch, 영문코드 자동생성)
- [x] 특정휴무일 캘린더 → 날짜입력+리스트 약소형 변경
- [x] 근로계약서 회사명 드롭다운 + 최근 계약서 내용 자동 불러오기
- [x] 수익분석 → 월정산 페이지 전면 개편 (settlementData API + 5섹션 MonthlySettlementPage)
- [x] 운영캘린더 상세뷰 → 일일운영 바로가기 (DailyOpsPage ?date= 파라미터)
- [x] 체크리스트 적용 기간 관리 (effectiveFrom/effectiveTo, 소프트 삭제)

---

## 폐기된 계획 (진행 불필요)

- ~~오픈/발주/마감 분리 제거 → 태그 통합~~ : 현행 4탭 구조가 현장 운영 흐름과 일치. 태그 전환 시 학습비용+마이그레이션 대비 실익 없음
- ~~매출 + 분석캘린더 → "매출캘린더"로 통합~~ : SalesPage(일별 입력)와 ProfitPage(월별 분석)는 용도가 다름. 합치면 양쪽 사용성 저하
- ~~월마감 인건비 자동 계산 (스케줄×시급)~~ : 일마감에서 수동 입력된 laborCost를 admin 대시보드가 이미 참조. 자동 계산 추가 시 이중 집계 위험
- ~~OCR 클라이언트 수동 이미지 회전 UI~~ : 서버 detectAndFixOrientation()이 AI 기반 자동 회전 처리. 수동 UI는 과잉
- ~~OCR 사용자 수정 → 프로파일 피드백 루프~~ : 오인식 수정값이 프로파일 오염 가능. 현행 OCR 결과 기반 자동 학습이 더 안전

---

## 진행 중: 발주 메모 재설계 (2026-04-05~)

> 스펙: `docs/purchase-memo-redesign.md`

매입탭 발주입력을 "발주 메모 + 입고 리마인더"로 단순화. OCR 전표입력은 별도 유지.

- [ ] Step 1: 스키마 수정 — purchaseOrdersV2에 content/counterpartyName/isReceived 추가, status에 'memo' 추가
- [ ] Step 2: tRPC API — createMemo, listMemosByDate, toggleReceived, listUnreceived 4개
- [ ] Step 3: DailyOpsPage 매입탭 UI 교체 — 메모 리스트 + 간단입력폼, OCR 분리 유지
- [ ] Step 4: 리마인더 — 대시보드/운영일지에 미입고 발주 알림
- [ ] Step 5: 기존 데이터 호환 확인
- [ ] Step 6: 검증 (발주메모 CRUD + OCR 정상 + 월정산 연동)

---

## 예정 작업 (보류)

- [ ] OCR corrections → 품목 alias 매핑 자동화: 사용자가 퍼지매칭 후보를 선택/무시한 이력(ocr_corrections)을 counterparty_ocr_profiles.frequentItems에 alias로 반영 → 동일 거래처 다음 OCR 시 자동매칭 정확도 향상. 오인식 수정값 프로파일 오염 리스크 있으므로, 일정 횟수(3회+) 동일 수정 패턴이 반복될 때만 반영하는 필터 필요
- [ ] ProfitPage.tsx 삭제 (dead code, MonthlySettlementPage로 대체됨)
- [ ] 체크리스트 적용기간 중간안: 시즌한정 설정 UI, 예약등록(미래 effectiveFrom), 비활성 항목 목록/복원 기능
- [ ] dailySalesDetail 데이터 없는 매장의 월정산 매출표시: sales 테이블 fallback 검토 필요
