-- daily_closings 테이블에 수정 이력 컬럼 추가
ALTER TABLE `daily_closings`
  ADD COLUMN `lastModifiedBy` int,
  ADD COLUMN `lastModifiedAt` timestamp,
  ADD COLUMN `editHistory` json;
