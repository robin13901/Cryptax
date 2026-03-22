CREATE TABLE `earn_income` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`amount` text NOT NULL,
	`eur_value_at_receipt` text NOT NULL,
	`received_at` text NOT NULL,
	`transaction_id` integer,
	`tax_year` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `idx_earn_income_tax_year` ON `earn_income` (`tax_year`);--> statement-breakpoint
CREATE TABLE `exchange_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`last_sync_at` text,
	`created_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `fifo_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`original_amount` text NOT NULL,
	`remaining_amount` text NOT NULL,
	`cost_basis_eur` text NOT NULL,
	`cost_per_unit_eur` text NOT NULL,
	`fee_eur` text NOT NULL,
	`acquired_at` text NOT NULL,
	`transaction_id` integer,
	`tax_year` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `idx_fifo_lots_symbol_acquired_at` ON `fifo_lots` (`symbol`,`acquired_at`);--> statement-breakpoint
CREATE INDEX `idx_fifo_lots_tax_year` ON `fifo_lots` (`tax_year`);--> statement-breakpoint
CREATE TABLE `futures_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`realized_pnl_eur` text NOT NULL,
	`fee_eur` text NOT NULL,
	`transaction_id` integer,
	`tax_year` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `idx_futures_positions_tax_year` ON `futures_positions` (`tax_year`);--> statement-breakpoint
CREATE TABLE `lot_consumptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_id` integer NOT NULL,
	`sell_transaction_id` integer NOT NULL,
	`amount_consumed` text NOT NULL,
	`cost_basis_eur` text NOT NULL,
	`proceeds_eur` text NOT NULL,
	`gain_loss_eur` text NOT NULL,
	`fee_eur` text NOT NULL,
	`held_days` integer NOT NULL,
	`haltefrist_met` integer NOT NULL,
	`tax_year` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `fifo_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sell_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `idx_lot_consumptions_tax_year` ON `lot_consumptions` (`tax_year`);--> statement-breakpoint
CREATE INDEX `idx_lot_consumptions_sell_transaction` ON `lot_consumptions` (`sell_transaction_id`);--> statement-breakpoint
CREATE TABLE `price_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`timestamp` text NOT NULL,
	`eur_price` text NOT NULL,
	`source` text NOT NULL,
	`usdt_price` text,
	`usdt_eur_rate` text,
	`fetched_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `idx_price_cache_symbol_timestamp` ON `price_cache` (`symbol`,`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_price_cache_symbol_timestamp_source` ON `price_cache` (`symbol`,`timestamp`,`source`);--> statement-breakpoint
CREATE TABLE `tax_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_year` integer NOT NULL,
	`bucket` text NOT NULL,
	`total_gains_eur` text NOT NULL,
	`total_losses_eur` text NOT NULL,
	`net_eur` text NOT NULL,
	`taxable_amount_eur` text NOT NULL,
	`estimated_tax_eur` text NOT NULL,
	`trade_count` integer NOT NULL,
	`computed_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tax_summaries_year_bucket` ON `tax_summaries` (`tax_year`,`bucket`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text,
	`exchange` text NOT NULL,
	`source_type` text NOT NULL,
	`canonical_type` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text,
	`amount` text NOT NULL,
	`price` text NOT NULL,
	`fee` text NOT NULL,
	`total_value` text NOT NULL,
	`traded_at` text NOT NULL,
	`tax_year` integer NOT NULL,
	`source_file` text,
	`raw_row` text,
	`checksum` text NOT NULL,
	`imported_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `idx_transactions_tax_year` ON `transactions` (`tax_year`);--> statement-breakpoint
CREATE INDEX `idx_transactions_symbol` ON `transactions` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_transactions_traded_at` ON `transactions` (`traded_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_transaction_order_exchange_checksum` ON `transactions` (`order_id`,`exchange`,`checksum`);
