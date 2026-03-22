import fs from "fs";
import path from "path";
import { execFile } from "child_process";

import { db } from "./client";
import { seedDb } from "./seed";

const backendRoot = path.resolve(__dirname, "..", "..");

function drizzleKitBinPath() {
  const binBase = path.join(backendRoot, "node_modules", ".bin", "drizzle-kit");
  // On Windows, pnpm usually creates a `.cmd` shim.
  if (process.platform === "win32" && fs.existsSync(`${binBase}.cmd`)) {
    return `${binBase}.cmd`;
  }
  return binBase;
}

function runDrizzlePush() {
  return new Promise<void>((resolve, reject) => {
    const bin = drizzleKitBinPath();
    const args = ["push", "--config", "./drizzle.config.ts"];

    const isWindows = process.platform === "win32";
    execFile(bin, args, { cwd: backendRoot, shell: isWindows }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function bootstrapDb() {
  // `drizzle-kit push` creates the SQLite tables from the current schema.
  await runDrizzlePush();
  await seedDb(db);
}

