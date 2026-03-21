CREATE TABLE `daily_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`operationDate` date NOT NULL,
	`openCheckedAt` timestamp,
	`openCheckedBy` int,
	`openHeadcount` int DEFAULT 0,
	`openLaborCost` decimal(14,2) DEFAULT '0',
	`closeCheckedAt` timestamp,
	`closeCheckedBy` int,
	`closeHeadcount` int DEFAULT 0,
	`closeLaborCost` decimal(14,2) DEFAULT '0',
	`closeNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_operations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_sales_detail` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`saleDate` date NOT NULL,
	`cashAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`cardAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`receiptCount` int NOT NULL DEFAULT 0,
	`discountAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`otherAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`totalAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`status` enum('draft','submitted','confirmed') NOT NULL DEFAULT 'draft',
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`recordedBy` int,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_sales_detail_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `intermediate_sales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`saleDate` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	`recordedBy` int,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `intermediate_sales_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_other_item_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`itemName` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_other_item_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales_other_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dailySalesDetailId` int NOT NULL,
	`restaurantId` int NOT NULL,
	`itemName` varchar(100) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_other_items_id` PRIMARY KEY(`id`)
);
