/** `%term%` pattern for ilike with `\`, `%` and `_` escaped so user input matches literally. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}
