CREATE TABLE `counterparties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`counterpartyType` enum('supplier','online','mart','repair','other') NOT NULL DEFAULT 'supplier',
	`isActive` boolean NOT NULL DEFAULT true,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `counterparties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `counterparty_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`counterpartyId` int NOT NULL,
	`itemId` int NOT NULL,
	`supplierItemName` varchar(100),
	`purchaseUnit` varchar(30),
	`conversionToBase` decimal(10,4) DEFAULT '1',
	`decimalAllowed` boolean NOT NULL DEFAULT false,
	`quantityStep` decimal(10,4) DEFAULT '1',
	`defaultPrice` decimal(14,2),
	`lastPrice` decimal(14,2),
	`isPreferred` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `counterparty_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`itemType` enum('product','service','misc') NOT NULL DEFAULT 'product',
	`costingCategory` varchar(50),
	`baseUnit` varchar(30),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_items_v2` (
	`id` int AUTO_INCREMENT NOT NULL,
	`purchaseOrderId` int NOT NULL,
	`itemId` int,
	`counterpartyItemId` int,
	`rawItemName` varchar(100),
	`itemType` enum('product','service','misc') NOT NULL DEFAULT 'product',
	`quantity` decimal(10,4),
	`unitName` varchar(30),
	`conversionToBase` decimal(10,4),
	`unitPrice` decimal(14,2),
	`lineTotal` decimal(14,2) NOT NULL,
	`costingCategory` varchar(50),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchase_order_items_v2_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders_v2` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`counterpartyId` int,
	`purchaseDate` date NOT NULL,
	`status` enum('received','ordered') NOT NULL DEFAULT 'received',
	`note` text,
	`attachmentUrl` text,
	`totalAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchase_orders_v2_id` PRIMARY KEY(`id`)
);
