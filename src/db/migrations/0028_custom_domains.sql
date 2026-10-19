-- Custom domains (#85): host→page bindings + per-page scope.
-- Existing installs boot unchanged: the table starts empty (the proxy
-- falls through to the exact pre-#85 behavior) and pages.domain_scope is
-- NULL (= 'exclusive', only consulted once a domain is bound).
CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer NOT NULL,
	`host` text NOT NULL,
	`kind` text DEFAULT 'primary' NOT NULL,
	`behavior` text DEFAULT 'serve' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_host_unique` ON `domains` (`host`);
--> statement-breakpoint
CREATE INDEX `domains_page_id_idx` ON `domains` (`page_id`);
--> statement-breakpoint
ALTER TABLE `pages` ADD `domain_scope` text;
