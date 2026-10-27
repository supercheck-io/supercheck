import { z } from "zod";

export const MAX_FEEDBACK_NOTE_LENGTH = 500;

/** One line, no control characters, bounded; empty becomes null. */
export function normalizeFeedbackNote(note: string | null | undefined): string | null {
  const cleaned = (note ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FEEDBACK_NOTE_LENGTH);
  return cleaned || null;
}

/** Request field for a responder's re-run note. */
export const investigationGuidanceSchema = z
  .string()
  .max(MAX_FEEDBACK_NOTE_LENGTH * 2)
  .transform((value) => normalizeFeedbackNote(value));
