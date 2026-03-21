ALTER TABLE `purchases` ADD `purchaseStatus` enum('received','ordered') DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `expectedArrivalDate` date;--> statement-breakpoint
ALTER TABLE `purchases` ADD `arrivedAt` timestamp;--> statement-breakpoint
ALTER TABLE `purchases` ADD `arrivedBy` int;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `salesInputStartTime` varchar(5);--> statement-breakpoint
ALTER TABLE `restaurants` ADD `salesInputEndTime` varchar(5);