/**
 * Shared filesystem utilities to eliminate duplicated helpers across commands.
 */
import { access } from "node:fs/promises";

/**
 * Check whether a file/directory exists at the given path.
 * Returns false instead of throwing when the path is absent.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
