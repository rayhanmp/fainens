import fs from "fs";
import path from "path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db } from "./client";
import { seedDb } from "./seed";

const backendRoot = path.resolve(__dirname, "..", "..");

export async function bootstrapDb() {
  const migrationsFolder = path.join(backendRoot, "drizzle");
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");

  if (!fs.existsSync(journalPath)) {
    throw new Error(`Migration journal not found: ${journalPath}`);
  }

  // The better-sqlite3 migrator is synchronous and records every applied
  // migration in __drizzle_migrations. Startup must fail closed if the schema
  // cannot be brought to the checked-in version.
  migrate(db, { migrationsFolder });
  await seedDb(db);
}

