CREATE TABLE `restaurant_contracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`contractType` enum('rent','commission','royalty','investor','other') NOT NULL,
	`name` varchar(200) NOT NULL,
	`calcType` enum('fixed','ratio') NOT NULL DEFAULT 'fixed',
	`fixedAmount` decimal(14,2) DEFAULT '0',
	`ratioPercent` decimal(6,3) DEFAULT '0',
	`startDate` date,
	`endDate` date,
	`note` text,
	`autoApplyToFixedCost` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurant_contracts_id` PRIMARY KEY(`id`)
);
