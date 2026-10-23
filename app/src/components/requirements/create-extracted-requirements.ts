import type { createRequirement } from "@/actions/requirements";

export interface ExtractedRequirementInput {
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
 * leave the list, and everything else (including unselected rows) stays. Retrying then cannot duplicate rows.
 */
export function withoutCreated<T extends { id: string }>(all: T[], selected: T[], created: number): T[] {
  const written = new Set(selected.slice(0, created).map((row) => row.id));
  return all.filter((row) => !written.has(row.id));
}
