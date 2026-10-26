import { z } from "zod";

export const MAX_TAGS_PER_ENTITY = 10;

/** Body of PATCH .../tags: per-tag add/remove applied atomically (ids deduplicated). */
export const tagPatchSchema = z
  .object({
    add: z.array(z.string().uuid()).max(MAX_TAGS_PER_ENTITY).default([]),
    remove: z.array(z.string().uuid()).max(MAX_TAGS_PER_ENTITY).default([]),
  })
  .transform((v) => ({ add: [...new Set(v.add)], remove: [...new Set(v.remove)] }))
  .refine((v) => !v.add.some((id) => v.remove.includes(id)), {
    message: "A tag cannot be both added and removed",
  });

/** Thrown inside the transaction to roll it back when the cap would be exceeded. */
export class TagLimitError extends Error {}
