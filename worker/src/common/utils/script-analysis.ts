import { collectUnboundHelperCalls } from './helper-call-analysis';

/**
 * Extract getFile() and readFile() key references from test script contents.
 * Used to filter file variables to only those actually needed for execution,
 * avoiding unnecessary S3 downloads and bandwidth costs.
 */
export function extractGetFileKeys(scripts: string[]): Set<string> {
  const keys = new Set<string>();
  for (const script of scripts) {
    for (const call of collectUnboundHelperCalls(script)) {
      if (call.literalKey) {
        keys.add(call.literalKey);
      }
    }
  }
  return keys;
}

/**
 * Check whether any script contains a getFile() or readFile() call (with or
 * without extractable string-literal keys).  Used to distinguish "no file
 * access at all" from "dynamic key lookup that we can't statically resolve".
 */
export function scriptsContainGetFile(scripts: string[]): boolean {
  return scripts.some((script) => collectUnboundHelperCalls(script).length > 0);
}

/**
 * Count the total number of getFile() and readFile() call sites across all scripts.
 */
export function countAllGetFileCalls(scripts: string[]): number {
  let count = 0;
  for (const script of scripts) {
    count += collectUnboundHelperCalls(script).length;
  }
  return count;
}

/**
 * Count the number of getFile() and readFile() call sites that use a
 * string-literal argument (i.e. calls whose key we can statically extract).
 */
export function countLiteralGetFileCalls(scripts: string[]): number {
  let count = 0;
  for (const script of scripts) {
    count += collectUnboundHelperCalls(script).filter(
      (call) => call.literalKey !== undefined,
    ).length;
  }
  return count;
}

/**
 * Filter a file variables map to only include entries whose keys
 * are referenced by getFile() or readFile() calls in the provided scripts.
 * Returns the full map if no scripts are provided (backwards-compatible).
 *
 * When file access calls exist but all keys are dynamic (no string-literal
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
