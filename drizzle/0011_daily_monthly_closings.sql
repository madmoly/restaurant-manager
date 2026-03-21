CREATE TABLE IF NOT EXISTS `daily_closings` (
`id` int AUTO_INCREMENT NOT NULL,
`restaurantId` int NOT NULL,
`closingDate` date NOT NULL,
`salesTotal` decimal(14,2) NOT NULL DEFAULT '0',
`purchasesTotal` decimal(14,2) NOT NULL DEFAULT '0',
`laborCost` decimal(14,2) NOT NULL DEFAULT '0',
`fixedCostShare` decimal(14,2) NOT NULL DEFAULT '0',
`profit` decimal(14,2) NOT NULL DEFAULT '0',
`note` text,
`closedBy` int,
`closedAt` timestamp NULL,
`createdAt` timestamp NOT NULL DEFAULT (now()),
`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT `daily_closings_id` PRIMARY KEY(`id`),
UNIQUE KEY `daily_closings_restaurant_date` (`restaurantId`, `closingDate`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `monthly_closings` (
`id` int AUTO_INCREMENT NOT NULL,
`restaurantId` int NOT NULL,
`year` int NOT NULL,
`month` int NOT NULL,
`salesTotal` decimal(14,2) NOT NULL DEFAULT '0',
`purchasesTotal` decimal(14,2) NOT NULL DEFAULT '0',
`laborCost` decimal(14,2) NOT NULL DEFAULT '0',
`fixedCostsTotal` decimal(14,2) NOT NULL DEFAULT '0',
`profit` decimal(14,2) NOT NULL DEFAULT '0',
`note` text,
`closedBy` int,
`closedAt` timestamp NULL,
`createdAt` timestamp NOT NULL DEFAULT (now()),
`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT `monthly_closings_id` PRIMARY KEY(`id`),
UNIQUE KEY `monthly_closings_restaurant_year_month` (`restaurantId`, `year`, `month`)
);
