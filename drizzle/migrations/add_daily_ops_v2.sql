-- 1. restaurants: 날씨 조회용 위도/경도
ALTER TABLE restaurants
  ADD COLUMN latitude DECIMAL(10,7) NULL AFTER address,
  ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude;

-- 2. daily_sales_detail: 상품권 / 계좌이체 매출 유형 추가
ALTER TABLE daily_sales_detail
  ADD COLUMN giftCardAmount DECIMAL(14,2) NOT NULL DEFAULT '0' AFTER cardAmount,
  ADD COLUMN transferAmount DECIMAL(14,2) NOT NULL DEFAULT '0' AFTER giftCardAmount;

-- 3. 일별 발주 이미지
CREATE TABLE IF NOT EXISTS daily_order_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  restaurantId INT NOT NULL,
  imageDate DATE NOT NULL,
  imageUrl TEXT NOT NULL,
  note VARCHAR(200),
  uploadedBy INT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_doi_restaurant_date (restaurantId, imageDate)
);

-- 4. 매출 특이사항 (할인/외상/미입금 등)
CREATE TABLE IF NOT EXISTS daily_sales_special_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dailySalesDetailId INT NOT NULL,
  restaurantId INT NOT NULL,
  typeName VARCHAR(50) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  note TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_dssi_detail (dailySalesDetailId),
  INDEX idx_dssi_restaurant (restaurantId)
);
