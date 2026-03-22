import fs from "fs";
import path from "path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const backendRoot = path.resolve(__dirname, "..", "..");
const dbPath = path.join(backendRoot, "data", "fainens.db");

// Ensure DB directory exists even on fresh containers.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);

export const db = drizzle(sqlite);

