CREATE TABLE transaction_reallocation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incoming_transaction_id INTEGER NOT NULL REFERENCES "transaction"(id) ON DELETE RESTRICT,
  outgoing_transaction_id INTEGER NOT NULL REFERENCES "transaction"(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  CHECK (incoming_transaction_id <> outgoing_transaction_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX reallocation_incoming_unique ON transaction_reallocation(incoming_transaction_id);
--> statement-breakpoint
CREATE UNIQUE INDEX reallocation_outgoing_unique ON transaction_reallocation(outgoing_transaction_id);
--> statement-breakpoint
CREATE TRIGGER reallocation_pair_unique BEFORE INSERT ON transaction_reallocation
WHEN EXISTS (SELECT 1 FROM transaction_reallocation WHERE incoming_transaction_id IN (NEW.incoming_transaction_id, NEW.outgoing_transaction_id) OR outgoing_transaction_id IN (NEW.incoming_transaction_id, NEW.outgoing_transaction_id))
BEGIN SELECT RAISE(ABORT, 'Transaction already belongs to a reallocation'); END;
