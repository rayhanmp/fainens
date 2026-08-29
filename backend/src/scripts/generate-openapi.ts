import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Fastify's unnamed wildcard route (`/files/*`) is emitted by Swagger as
 * `{*}`, which is not a valid OpenAPI path parameter and makes generators
 * produce invalid TypeScript. Preserve the route while giving the contract a
 * stable, standards-compliant parameter name.
 */
function normalizeWildcardPaths(document: { paths?: Record<string, any> }) {
  if (!document.paths) return;
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!path.includes("{*}")) continue;
    const normalizedPath = path.replace("{*}", "{path}");
    const normalizedItem = { ...pathItem };
    for (const [method, operation] of Object.entries(normalizedItem)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== "object") continue;
      const existingParameters = Array.isArray((operation as any).parameters) ? (operation as any).parameters : [];
      if (!existingParameters.some((parameter: any) => parameter?.name === "path" && parameter?.in === "path")) {
        (operation as any).parameters = [
          ...existingParameters,
          { name: "path", in: "path", required: true, schema: { type: "string" } },
        ];
      }
    }
    document.paths[normalizedPath] = normalizedItem;
    delete document.paths[path];
  }
}

async function generate() {
  console.info("Generating OpenAPI contract...");
  // Route registration must not require a writable database or a native
  // SQLite binding. Handlers are never invoked by this script.
  process.env.FAINENS_CONTRACT_ONLY = "true";
  const { buildApp } = await import("../app");
  const app = await buildApp({ runtime: "contract" });
  console.info("Preparing Fastify route registry...");
  await app.ready();
  const document = app.swagger();
  normalizeWildcardPaths(document);
  const outputDir = resolve(__dirname, "../../../contracts");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, "openapi.json"), `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.info("OpenAPI contract generated.");
}

void generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
