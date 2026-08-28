import fs from "fs";
import path from "path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const backendRoot = path.resolve(__dirname, "..", "..");
const configuredDbPath = process.env.FAINENS_DB_PATH?.trim();
const dbPath = configuredDbPath
  ? path.resolve(configuredDbPath)
  : path.join(backendRoot, "data", "fainens.db");

/**
 * Contract generation only needs route registration and must not open SQLite.
 * Route handlers still reference this value, so expose a typed sentinel that
 * fails loudly if a contract-only bootstrap accidentally executes a handler.
 */
const contractOnly = process.env.FAINENS_CONTRACT_ONLY === "true";
type DrizzleDatabase = ReturnType<typeof drizzle>;

function unavailableContractDatabase(): DrizzleDatabase {
  return new Proxy({} as DrizzleDatabase, {
    get() {
      throw new Error("Database access is unavailable during contract generation");
    },
  });
}

function openDatabase(): DrizzleDatabase {
  // Ensure DB directory exists even on fresh containers.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return drizzle(new Database(dbPath));
}

export const db: DrizzleDatabase = contractOnly ? unavailableContractDatabase() : openDatabase();

