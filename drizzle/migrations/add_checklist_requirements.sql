-- 체크리스트 요구사항 기능 추가 마이그레이션
-- 실행일: 2026-03-23

-- 1. 템플릿에 요구사항 타입 컬럼 추가
ALTER TABLE store_checklist_templates
  ADD COLUMN requirementType ENUM('none', 'text_input', 'camera_photo') NOT NULL DEFAULT 'none'
  AFTER itemText;

-- 2. 로그에 응답 데이터 JSON 컬럼 추가 (기존 checkedItemIds와 병행)
ALTER TABLE daily_checklist_logs
  ADD COLUMN checkedItems JSON DEFAULT '[]'
  AFTER checkedItemIds;
