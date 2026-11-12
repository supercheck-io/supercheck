import { Braces, FileText, FolderOpen, KeyRound, Lock, UserPlus, type LucideIcon } from "lucide-react";

/**
 * Single registry for the colour of a TYPE (test, monitor, job, variable, AI SRE setup, admin setup).
 * Areas (nav-areas.ts) say where you are; types say what a thing is. Every surface (sidebar, Quick Create,
 * Cmd+K, tables, pickers, dialogs) reads the tone from here, never an ad-hoc palette class.
 * Tests and monitors reuse the five original colours on purpose (API test and HTTP monitor are both teal).
 * Brand marks (Playwright, k6, Chrome) keep their own colours; their type tone tints the chip and text around them.
 */
export const TYPE_TONES = ["sky", "teal", "cyan", "blue", "purple", "indigo", "violet", "orchid", "slate", "zinc", "stone", "lime", "clay", "olive"] as const;
export type TypeTone = (typeof TYPE_TONES)[number];

export const TYPE_TONE = {
  test: { browser: "sky", api: "teal", database: "cyan", custom: "blue", performance: "purple" },
  monitor: { http_request: "teal", website: "sky", ping_host: "cyan", port_check: "blue", synthetic_test: "purple" },
  // A job runs a test engine, so it shares the tone of that test type.
  job: { playwright: "sky", k6: "purple" },
  variable: { variable: "stone", secret: "violet", file: "indigo" },
  sre: { service: "orchid", integration: "clay", privateAgent: "olive" },
  admin: { project: "slate", member: "lime", cliToken: "zinc" },
} as const satisfies Record<string, Record<string, TypeTone>>;

type Group = keyof typeof TYPE_TONE;
type Key<G extends Group> = keyof (typeof TYPE_TONE)[G] & string;

// Static class strings so Tailwind can see them.
export const TYPE_TEXT: Record<TypeTone, string> = {
  sky: "text-type-sky",
  teal: "text-type-teal",
  cyan: "text-type-cyan",
  blue: "text-type-blue",
  purple: "text-type-purple",
  indigo: "text-type-indigo",
  violet: "text-type-violet",
  orchid: "text-type-orchid",
  slate: "text-type-slate",
  zinc: "text-type-zinc",
  stone: "text-type-stone",
  lime: "text-type-lime",
  clay: "text-type-clay",
  olive: "text-type-olive",
};

/** Same colour with `!`, for sidebar and command items whose button sets the svg colour. */
export const TYPE_TEXT_FORCE: Record<TypeTone, string> = {
  sky: "!text-type-sky",
  teal: "!text-type-teal",
  cyan: "!text-type-cyan",
  blue: "!text-type-blue",
  purple: "!text-type-purple",
  indigo: "!text-type-indigo",
  violet: "!text-type-violet",
  orchid: "!text-type-orchid",
  slate: "!text-type-slate",
  zinc: "!text-type-zinc",
  stone: "!text-type-stone",
  lime: "!text-type-lime",
  clay: "!text-type-clay",
  olive: "!text-type-olive",
};

/** Tinted square for IconChip (same 10% fill as the area chips). */
export const TYPE_CHIP: Record<TypeTone, string> = {
  sky: "bg-type-sky/10 text-type-sky",
  teal: "bg-type-teal/10 text-type-teal",
  cyan: "bg-type-cyan/10 text-type-cyan",
  blue: "bg-type-blue/10 text-type-blue",
  purple: "bg-type-purple/10 text-type-purple",
  indigo: "bg-type-indigo/10 text-type-indigo",
  violet: "bg-type-violet/10 text-type-violet",
  orchid: "bg-type-orchid/10 text-type-orchid",
  slate: "bg-type-slate/10 text-type-slate",
  zinc: "bg-type-zinc/10 text-type-zinc",
  stone: "bg-type-stone/10 text-type-stone",
  lime: "bg-type-lime/10 text-type-lime",
  clay: "bg-type-clay/10 text-type-clay",
  olive: "bg-type-olive/10 text-type-olive",
};

/** Active sidebar icon colour. */
export const TYPE_ACTIVE_ICON: Record<TypeTone, string> = {
  sky: "[&[data-active=true]>svg]:text-type-sky",
  teal: "[&[data-active=true]>svg]:text-type-teal",
  cyan: "[&[data-active=true]>svg]:text-type-cyan",
  blue: "[&[data-active=true]>svg]:text-type-blue",
  purple: "[&[data-active=true]>svg]:text-type-purple",
  indigo: "[&[data-active=true]>svg]:text-type-indigo",
  violet: "[&[data-active=true]>svg]:text-type-violet",
  orchid: "[&[data-active=true]>svg]:text-type-orchid",
  slate: "[&[data-active=true]>svg]:text-type-slate",
  zinc: "[&[data-active=true]>svg]:text-type-zinc",
  stone: "[&[data-active=true]>svg]:text-type-stone",
  lime: "[&[data-active=true]>svg]:text-type-lime",
  clay: "[&[data-active=true]>svg]:text-type-clay",
  olive: "[&[data-active=true]>svg]:text-type-olive",
};

/** Hover border for picker cards. */
export const TYPE_HOVER_BORDER: Record<TypeTone, string> = {
  sky: "hover:border-type-sky/50",
  teal: "hover:border-type-teal/50",
  cyan: "hover:border-type-cyan/50",
  blue: "hover:border-type-blue/50",
  purple: "hover:border-type-purple/50",
  indigo: "hover:border-type-indigo/50",
  violet: "hover:border-type-violet/50",
  orchid: "hover:border-type-orchid/50",
  slate: "hover:border-type-slate/50",
  zinc: "hover:border-type-zinc/50",
  stone: "hover:border-type-stone/50",
  lime: "hover:border-type-lime/50",
  clay: "hover:border-type-clay/50",
  olive: "hover:border-type-olive/50",
};

export const typeTone = <G extends Group>(group: G, key: Key<G>): TypeTone =>
  (TYPE_TONE[group] as Record<string, TypeTone>)[key];
export const typeText = <G extends Group>(group: G, key: Key<G>) => TYPE_TEXT[typeTone(group, key)];
export const typeTextForce = <G extends Group>(group: G, key: Key<G>) => TYPE_TEXT_FORCE[typeTone(group, key)];

/** Icon, label and tone for the types that have no data file of their own. */
export const VARIABLE_TYPES: Record<Key<"variable">, { label: string; icon: LucideIcon; tone: TypeTone }> = {
  variable: { label: "Variable", icon: Braces, tone: TYPE_TONE.variable.variable },
  secret: { label: "Secret", icon: Lock, tone: TYPE_TONE.variable.secret },
  file: { label: "File", icon: FileText, tone: TYPE_TONE.variable.file },
};

export const ADMIN_TYPES: Record<Key<"admin">, { icon: LucideIcon }> = {
  project: { icon: FolderOpen },
  member: { icon: UserPlus },
  cliToken: { icon: KeyRound },
};
