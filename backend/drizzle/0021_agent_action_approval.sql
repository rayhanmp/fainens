CREATE TABLE `agent_pending_action` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`conversation_id` integer,
	`kind` text NOT NULL,
	`normalized_input` text NOT NULL,
	`assumptions` text,
	`missing_fields` text,
	`base_financial_revision` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_agent_pending_action_owner_status` ON `agent_pending_action` (`owner_email`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_agent_pending_action_conversation` ON `agent_pending_action` (`conversation_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `agent_approval` (
	`id` integer PRIMARY KEY NOT NULL,
	`pending_action_id` integer NOT NULL,
	`owner_email` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`idempotency_key` text NOT NULL UNIQUE,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_at` integer,
	`executed_at` integer,
	`execution_receipt` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('now') * 1000) NOT NULL,
	FOREIGN KEY (`pending_action_id`) REFERENCES `agent_pending_action`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_agent_approval_owner_status` ON `agent_approval` (`owner_email`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_agent_approval_pending_action` ON `agent_approval` (`pending_action_id`);
