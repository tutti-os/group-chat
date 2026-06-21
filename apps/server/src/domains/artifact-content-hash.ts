import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";

const FILE_HASH_BUFFER_BYTES = 1024 * 1024;
const FILE_HASH_CACHE_LIMIT = 512;

type FileHashCacheEntry = {
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
};

const fileHashCache = new Map<string, FileHashCacheEntry>();

export function sha256ForBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256ForFile(localPath: string): string | null {
  let stat;
  try {
    stat = statSync(localPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const cached = fileHashCache.get(localPath);
  if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.sha256;
  }

  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(FILE_HASH_BUFFER_BYTES);
  let fd: number | null = null;
  try {
    fd = openSync(localPath, "r");
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }

  const sha256 = hash.digest("hex");
  fileHashCache.delete(localPath);
  fileHashCache.set(localPath, { sizeBytes: stat.size, mtimeMs: stat.mtimeMs, sha256 });
  while (fileHashCache.size > FILE_HASH_CACHE_LIMIT) {
    const oldest = fileHashCache.keys().next().value;
    if (typeof oldest !== "string") break;
    fileHashCache.delete(oldest);
  }
  return sha256;
}
