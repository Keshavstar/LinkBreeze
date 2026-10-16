ALTER TABLE `links` ADD `redirect_slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `links_redirect_slug_unique` ON `links` (`redirect_slug`);
