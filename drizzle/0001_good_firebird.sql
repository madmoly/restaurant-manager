CREATE TABLE `employee_contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`restaurantId` int NOT NULL,
	`wageType` enum('hourly','monthly') NOT NULL DEFAULT 'hourly',
	`wageAmount` decimal(12,2) NOT NULL DEFAULT '0',
	`position` varchar(50),
	`contractStart` date,
	`contractEnd` date,
	`contractNote` text,
	`weeklyHours` decimal(5,2),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `employee_contracts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monthly_fixed_costs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`effectiveMonth` varchar(7) NOT NULL,
	`costCategory` varchar(100) NOT NULL,
	`categoryType` enum('rent','utility','fee','labor_fixed','other') DEFAULT 'other',
	`amount` decimal(14,2) NOT NULL,
	`note` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monthly_fixed_costs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipientId` int,
	`type` enum('schedule_change','cost_exceeded','target_achieved','general') NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text,
	`restaurantId` int,
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`purchaseDate` date NOT NULL,
	`vendorName` varchar(100),
	`itemName` varchar(200) NOT NULL,
	`cost` decimal(14,2) NOT NULL,
	`category` enum('food','supply','utility','other') DEFAULT 'food',
	`receiptImageUrl` varchar(500),
	`receiptImageKey` varchar(300),
	`note` text,
	`source` varchar(50) DEFAULT 'manual',
	`rawData` json,
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurant_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('manager','employee') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `restaurant_users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`address` varchar(255),
	`phone` varchar(30),
	`monthlyTargetSales` decimal(14,2) DEFAULT '0',
	`targetLaborRatio` decimal(5,2) DEFAULT '30',
	`targetCostRatio` decimal(5,2) DEFAULT '80',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `restaurants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`saleDate` date NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`note` text,
	`source` varchar(50) DEFAULT 'manual',
	`rawData` json,
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`restaurantId` int NOT NULL,
	`startTime` timestamp NOT NULL,
	`endTime` timestamp NOT NULL,
	`status` enum('confirmed','change_requested','approved','rejected','off') NOT NULL DEFAULT 'confirmed',
	`changeReason` text,
	`note` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('master','admin','manager','employee','user') NOT NULL DEFAULT 'employee';--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(30);--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;