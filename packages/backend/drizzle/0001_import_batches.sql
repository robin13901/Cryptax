CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`source_type` text NOT NULL,
	`total_rows` integer NOT NULL,
	`imported_count` integer NOT NULL,
	`duplicates_count` integer NOT NULL,
	`errors_count` integer NOT NULL,
	`imported_at` text NOT NULL
) STRICT;
--> statement-breakpoint
ALTER TABLE `transactions` ADD `batch_id` integer REFERENCES import_batches(id);--> statement-breakpoint
CREATE INDEX `idx_transactions_batch_id` ON `transactions` (`batch_id`);
