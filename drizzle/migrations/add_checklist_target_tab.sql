-- 1. store_checklist_templates: checkType enum 확장 + targetTab 컬럼 추가
ALTER TABLE store_checklist_templates
  MODIFY COLUMN checkType ENUM('open','order','cleaning','hygiene','inventory','other') NOT NULL;

ALTER TABLE store_checklist_templates
  ADD COLUMN targetTab VARCHAR(20) NOT NULL DEFAULT 'open' AFTER checkType;

-- 2. 기존 데이터 targetTab 설정 (기본 매핑)
UPDATE store_checklist_templates SET targetTab = 'open' WHERE checkType = 'open';
UPDATE store_checklist_templates SET targetTab = 'purchase' WHERE checkType = 'order';
UPDATE store_checklist_templates SET targetTab = 'close' WHERE checkType = 'cleaning';

-- 3. daily_checklist_logs: checkType enum 확장
ALTER TABLE daily_checklist_logs
  MODIFY COLUMN checkType ENUM('open','order','cleaning','hygiene','inventory','other') NOT NULL;

-- 4. targetTab 인덱스
ALTER TABLE store_checklist_templates
  ADD INDEX idx_sct_target_tab (restaurantId, targetTab, isActive);
