import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { buildApp } from "../app";

async function generate() {
  console.info("Generating OpenAPI contract...");
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
