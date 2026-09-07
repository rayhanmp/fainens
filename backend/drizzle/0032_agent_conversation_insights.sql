CREATE TABLE `agent_conversation_insight` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `conversation_id` integer NOT NULL REFERENCES `agent_conversation`(`id`) ON DELETE cascade,
  `claim` text NOT NULL,
  `evidence_ids` text NOT NULL,
  `financial_revision` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at` integer NOT NULL DEFAULT (unixepoch('now') * 1000)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_conversation_insight_status` ON `agent_conversation_insight` (`conversation_id`, `status`, `updated_at`);
