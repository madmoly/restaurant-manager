ALTER TABLE `purchase_orders_v2`
  ADD COLUMN `lastModifiedBy` int,
  ADD COLUMN `lastModifiedAt` timestamp,
  ADD COLUMN `editHistory` json;
