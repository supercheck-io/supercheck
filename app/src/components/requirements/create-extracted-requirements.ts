import type { createRequirement } from "@/actions/requirements";

export interface ExtractedRequirementInput {
  /**
   * Stable per extracted row (minted once, when the rows are extracted). It is sent as the requirement id, so a
   * create whose response was lost and is then repeated finds the existing row instead of adding a second one.
   */
  clientId?: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | null;
  tags: string[];
}

export interface CreateExtractedResult {
  /** Rows actually written. */
  created: number;
  /** Why the batch stopped, when it did. */
  failure?: unknown;
}

/**
 * Creates the selected requirements one by one and stops at the first failure.
 *
 * The server action reports failure in its result instead of throwing (for example when the
 * source document was deleted or belongs to another project), so the result has to be checked
 * or the caller would report success for rows that were never written.
 */
export async function createExtractedRequirements(
  requirements: ExtractedRequirementInput[],
  documentId: string | null,
  create: typeof createRequirement,
  onProgress?: (created: number) => void,
): Promise<CreateExtractedResult> {
  let created = 0;
  for (const req of requirements) {
    try {
      // Combine AI-extracted tags with 'ai' marker, avoiding duplicates
      const allTags = new Set(["ai", ...req.tags]);
      const result = await create({
        id: req.clientId,
        title: req.title,
        description: req.description || "Extracted from document",
        priority: req.priority || "medium",
        tags: Array.from(allTags).join(", "),
        sourceDocumentId: documentId,
        createdBy: "ai",
      });
      if (!result.success) {
        return { created, failure: new Error(result.error || "Could not create requirement") };
      }
    } catch (failure) {
      return { created, failure };
    }
    created++;
    onProgress?.(created);
  }
  return { created };
}

/**
 * What is left to review after a batch stopped partway: the first `created` selected rows were written, so they
 * leave the list, and everything else (including unselected rows) stays. A write whose response was lost is not
 * counted here; it is covered by `clientId`, which makes repeating that create return the row it already made.
 */
export function withoutCreated<T extends { id: string }>(all: T[], selected: T[], created: number): T[] {
  const written = new Set(selected.slice(0, created).map((row) => row.id));
  return all.filter((row) => !written.has(row.id));
}
