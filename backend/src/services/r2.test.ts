import { describe, expect, it } from "vitest";
import { isAbsolute, relative, resolve } from "path";

import { resolveStorageKey } from "./storage-path";

const root = resolve(process.cwd(), "data", "attachments");

describe("local attachment path confinement", () => {
  it("resolves a generated nested object key below the storage root", () => {
    const resolved = resolveStorageKey(root, "attachments/42/receipt.pdf");
    const rel = relative(root, resolved);
    expect(rel.startsWith("..")).toBe(false);
    expect(isAbsolute(rel)).toBe(false);
  });

  it.each([
    "../secrets.txt",
    "../../data/fainens.db",
    "..\\secrets.txt",
    "C:\\Windows\\win.ini",
    "/etc/passwd",
  ])("rejects escaping key %s", (key) => {
    expect(() => resolveStorageKey(root, key)).toThrow();
  });

  it("rejects null bytes", () => {
    expect(() => resolveStorageKey(root, "attachments/a\0b")).toThrow("Invalid storage key");
  });
});
