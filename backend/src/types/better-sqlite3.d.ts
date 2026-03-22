declare module "better-sqlite3" {
  // Minimal typing shim for TypeScript builds.
  // The codebase uses `new Database(path)` and passes the instance to Drizzle.
  const Database: any;
  export default Database;
}

