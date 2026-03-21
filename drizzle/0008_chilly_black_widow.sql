CREATE TABLE `product_purchase_units` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`unitName` varchar(30) NOT NULL,
	`conversionToBase` decimal(14,4) NOT NULL DEFAULT '1',
	`decimalAllowed` boolean NOT NULL DEFAULT false,
	`quantityStep` decimal(10,4) NOT NULL DEFAULT '1',
	`isDefault` boolean NOT NULL DEFAULT false,
	CONSTRAINT `product_purchase_units_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`category` enum('food','supply','other') NOT NULL DEFAULT 'food',
	`baseUnit` varchar(20) NOT NULL DEFAULT '개',
	`defaultPrice` decimal(14,2) DEFAULT '0',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`purchaseOrderId` int NOT NULL,
	`productId` int NOT NULL,
	`quantity` decimal(12,4) NOT NULL,
	`unitName` varchar(30) NOT NULL,
	`conversionToBase` decimal(14,4) DEFAULT '1',
	`unitPrice` decimal(14,2) NOT NULL,
	`lineTotal` decimal(14,2) NOT NULL,
	`priceSource` enum('last','avg','default','manual') DEFAULT 'manual',
	`note` text,
	CONSTRAINT `purchase_order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`vendorId` int NOT NULL,
	`purchaseDate` date NOT NULL,
	`status` enum('received','ordered') NOT NULL DEFAULT 'received',
	`expectedArrivalDate` date,
	`note` text,
	`receiptImageUrl` varchar(500),
	`receiptImageKey` varchar(300),
	`totalAmount` decimal(14,2) NOT NULL DEFAULT '0',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchase_orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vendor_frequent_item_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`vendorId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`itemsJson` json NOT NULL,
	`isDefault` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vendor_frequent_item_sets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vendor_product_last_prices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vendorId` int NOT NULL,
	`productId` int NOT NULL,
	`unitName` varchar(30) NOT NULL,
	`lastUnitPrice` decimal(14,2) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vendor_product_last_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vendors_id` PRIMARY KEY(`id`)
);
