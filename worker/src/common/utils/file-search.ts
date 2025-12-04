import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';

async function pathExistsInternal(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  return pathExistsInternal(filePath);
}

export async function findFirstFileByNames(
  baseDir: string,
  fileNames: string[],
  options?: { maxDepth?: number },
): Promise<string | null> {
  const names = new Set(fileNames);
  return findFirstMatchingFile(
    baseDir,
    (fullPath, entryName) => names.has(entryName),
    options,
  );
}

export async function findFirstMatchingFile(
  baseDir: string,
  matcher: (fullPath: string, entryName: string) => boolean,
  options?: { maxDepth?: number },
): Promise<string | null> {
  const maxDepth = options?.maxDepth ?? 5;
  const visited = new Set<string>();

  async function traverse(
    current: string,
    depth: number,
  ): Promise<string | null> {
    if (depth > maxDepth) {
      return null;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (matcher(fullPath, entry.name)) {
        return fullPath;
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const nextPath = path.join(current, entry.name);
      if (visited.has(nextPath)) {
        continue;
      }
      visited.add(nextPath);
      const result = await traverse(nextPath, depth + 1);
      if (result) {
        return result;
      }
    }

    return null;
  }

  return traverse(baseDir, 0);
}
