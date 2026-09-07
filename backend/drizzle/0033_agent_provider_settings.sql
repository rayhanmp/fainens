CREATE TABLE `agent_provider_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `model` text NOT NULL,
  `api_key_ciphertext` text,
  `api_key_updated_at` integer
);
