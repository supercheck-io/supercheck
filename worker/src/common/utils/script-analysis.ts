/**
 * Extract getFile() key references from test script contents.
 * Used to filter file variables to only those actually needed for execution,
 * avoiding unnecessary S3 downloads and bandwidth costs.
 */
export function extractGetFileKeys(scripts: string[]): Set<string> {
  const keys = new Set<string>();
  const regex = /getFile\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (const script of scripts) {
    for (const match of script.matchAll(regex)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * Check whether any script contains a getFile() call (with or without
 * extractable string-literal keys).  Used to distinguish "no getFile
 * usage at all" from "dynamic key lookup that we can't statically resolve".
 */
export function scriptsContainGetFile(scripts: string[]): boolean {
  const dynamicRegex = /getFile\s*\(/;
  return scripts.some((s) => dynamicRegex.test(s));
}

/**
 * Count the total number of getFile() call sites across all scripts.
 */
export function countAllGetFileCalls(scripts: string[]): number {
  const regex = /getFile\s*\(/g;
  let count = 0;
  for (const script of scripts) {
    const matches = script.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Count the number of getFile() call sites that use a string-literal argument
 * (i.e. calls whose key we can statically extract).
 */
export function countLiteralGetFileCalls(scripts: string[]): number {
  const regex = /getFile\s*\(\s*['"`][^'"`]+['"`]/g;
  let count = 0;
  for (const script of scripts) {
    const matches = script.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Filter a file variables map to only include entries whose keys
 * are referenced by getFile() calls in the provided scripts.
 * Returns the full map if no scripts are provided (backwards-compatible).
 *
 * When getFile() calls exist but all keys are dynamic (no string-literal
 * arguments that we can extract), the full map is returned as a safe
 * fallback so that runtime resolution still works.
 */
export function filterFileVariablesToUsedKeys<
  T extends Record<string, unknown>,
>(files: T, scripts: string[]): T {
  if (!files || Object.keys(files).length === 0) return files;
  if (scripts.length === 0) return files;

  const usedKeys = extractGetFileKeys(scripts);
  const hasDynamicGetFile = scriptsContainGetFile(scripts);

  if (usedKeys.size === 0) {
    // No literal keys extracted — but if getFile() calls exist with
    // dynamic keys we can't resolve, return full map so they work at runtime.
    // Only return empty when getFile is not referenced at all.
    return hasDynamicGetFile ? files : ({} as T);
  }

  // If any getFile() call uses a non-literal (dynamic) argument we
  // cannot statically resolve, return the full map so that runtime
  // lookups still succeed.  We detect this by checking whether
  // getFile() appears more times than we could extract literal keys
  // — i.e. there is at least one call site we couldn't resolve.
  if (hasDynamicGetFile) {
    const literalCallCount = countLiteralGetFileCalls(scripts);
    const totalCallCount = countAllGetFileCalls(scripts);
    if (totalCallCount > literalCallCount) {
      return files;
    }
  }

  return Object.fromEntries(
    Object.entries(files).filter(([key]) => usedKeys.has(key)),
  ) as T;
}
