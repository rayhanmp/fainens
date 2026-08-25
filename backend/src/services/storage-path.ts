import { isAbsolute, relative, resolve } from "path";

export function resolveStorageKey(rootPath: string, key: string): string {
  if (!key || key.includes("\0")) throw new Error("Invalid storage key");
  const root = resolve(rootPath);
  const candidate = resolve(root, key);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Storage key escapes the attachment directory");
  }
  return candidate;
}
