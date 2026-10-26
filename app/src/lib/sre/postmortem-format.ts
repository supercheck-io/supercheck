import { z } from "zod";

import type { SrePostmortemSection } from "@/db/schema";

/** Client-safe: no server imports. */
export const POSTMORTEM_SECTIONS: ReadonlyArray<{ key: SrePostmortemSection; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "impact", label: "Impact" },
  { key: "timeline", label: "Timeline" },
  { key: "root_cause", label: "Root cause" },
  { key: "contributing_factors", label: "Contributing factors" },
  { key: "follow_ups", label: "Follow-ups" },
];
export const MAX_POSTMORTEM_SECTION_LENGTH = 4000;

export const postmortemSectionsSchema = z.object({
  summary: z.string().max(MAX_POSTMORTEM_SECTION_LENGTH).default(""),
  impact: z.string().max(MAX_POSTMORTEM_SECTION_LENGTH).default(""),
  timeline: z.string().max(MAX_POSTMORTEM_SECTION_LENGTH).default(""),
  root_cause: z.string().max(MAX_POSTMORTEM_SECTION_LENGTH).default(""),
  contributing_factors: z.string().max(MAX_POSTMORTEM_SECTION_LENGTH).default(""),
  follow_ups: z.string().max(MAX_POSTMORTEM_SECTION_LENGTH).default(""),
});
export type PostmortemSections = z.infer<typeof postmortemSectionsSchema>;

export function postmortemToMarkdown(input: {
  incidentNumber: number;
  title: string;
  sections: Partial<Record<SrePostmortemSection, string>>;
}): string {
  const lines = [`# Post-mortem: Incident #${input.incidentNumber} - ${input.title}`, ""];
  for (const { key, label } of POSTMORTEM_SECTIONS) {
    lines.push(`## ${label}`, "", input.sections[key]?.trim() || "_Not filled in._", "");
  }
  return lines.join("\n").trimEnd() + "\n";
}
