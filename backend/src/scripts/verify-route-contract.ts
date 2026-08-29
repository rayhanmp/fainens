/**
 * Verifies the route registry without opening SQLite, starting workers, or
 * listening on a port. This is intentionally separate from OpenAPI generation
 * so CI can fail fast on missing route contracts without rewriting artifacts.
 */
const oauthRedirectPath = "/api/auth/google";

async function verifyRouteContract() {
  process.env.FAINENS_CONTRACT_ONLY = "true";
  // Import the app only after contract mode is set. The DB client evaluates
  // this flag at module load time and must never open better-sqlite3 here.
  const { buildApp } = await import("../app");
  const app = await buildApp({ runtime: "contract" });

  try {
    await app.ready();
    const document = app.swagger();
    const operationIds = new Map<string, string>();
    const missingOperationIds: string[] = [];
    const missingResponses: string[] = [];
    const missingTags: string[] = [];
    const missingPathParameters: string[] = [];
    let operationCount = 0;

    for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(pathItem ?? {})) {
        if (!operation || typeof operation !== "object" || !["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) {
          continue;
        }

        operationCount += 1;
        const routeLabel = `${method.toUpperCase()} ${path}`;
        const operationId = "operationId" in operation && typeof operation.operationId === "string" ? operation.operationId : undefined;

        // @fastify/oauth2 owns this redirect route and does not expose route
        // options for assigning an operationId. Keep it as the sole explicit
        // exception until the plugin supports a schema override.
        if (path !== oauthRedirectPath && !operationId) {
          missingOperationIds.push(routeLabel);
        }

        if (operationId) {
          const previousRoute = operationIds.get(operationId);
          if (previousRoute) {
            throw new Error(`Duplicate operationId ${operationId}: ${previousRoute} and ${routeLabel}`);
          }
          operationIds.set(operationId, routeLabel);
        }

        if (!("responses" in operation) || !operation.responses || typeof operation.responses !== "object" || Object.keys(operation.responses).length === 0) {
          missingResponses.push(routeLabel);
        }

        // Tags keep the generated contract navigable and prevent unrelated
        // features from being silently grouped together in API tooling.
        if (path.startsWith("/api/") && path !== oauthRedirectPath && !("tags" in operation && Array.isArray(operation.tags) && operation.tags.length > 0)) {
          missingTags.push(routeLabel);
        }

        // Every path placeholder must have an explicit required path
        // parameter. This catches a surprisingly common source of generated
        // client/runtime mismatches.
        const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
        const parameters = "parameters" in operation && Array.isArray(operation.parameters) ? operation.parameters : [];
        for (const placeholder of placeholders) {
          const declared = parameters.some((parameter) => parameter && typeof parameter === "object"
            && "name" in parameter && parameter.name === placeholder
            && "in" in parameter && parameter.in === "path"
            && "required" in parameter && parameter.required === true);
          if (!declared) missingPathParameters.push(`${routeLabel} {${placeholder}}`);
        }
      }
    }

    const requiredPaths = ["/api/transactions/import-preview", "/api/transactions/import-confirm"];
    const missingRequiredPaths = requiredPaths.filter((path) => !(path in (document.paths ?? {})));

    if (missingOperationIds.length || missingResponses.length || missingTags.length || missingPathParameters.length || missingRequiredPaths.length) {
      throw new Error(JSON.stringify({ missingOperationIds, missingResponses, missingTags, missingPathParameters, missingRequiredPaths }, null, 2));
    }

    console.info(JSON.stringify({
      paths: Object.keys(document.paths ?? {}).length,
      operations: operationCount,
      operationIds: operationIds.size,
      taggedOperations: operationCount - missingTags.length,
      oauthRedirectException: oauthRedirectPath,
    }));
  } finally {
    await app.close();
  }
}

void verifyRouteContract().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
