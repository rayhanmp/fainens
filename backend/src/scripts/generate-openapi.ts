import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

async function generate() {
  console.info("Generating OpenAPI contract...");
  // Route registration must not require a writable database or a native
  // SQLite binding. Handlers are never invoked by this script.
  process.env.FAINENS_CONTRACT_ONLY = "true";
  const { buildApp } = await import("../app");
  const app = await buildApp({ runtime: "contract" });
  console.info("Preparing Fastify route registry...");
  await app.ready();
  const outputDir = resolve(__dirname, "../../../contracts");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "openapi.json"), `${JSON.stringify(app.swagger(), null, 2)}\n`);
  await app.close();
  console.info("OpenAPI contract generated.");
}

void generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
