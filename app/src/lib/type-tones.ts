import { Braces, FileText, FolderOpen, KeyRound, Lock, UserPlus, type LucideIcon } from "lucide-react";

/**
 * Single registry for the colour of a TYPE (test, monitor, job, variable, AI SRE setup, admin setup).
 * Areas (nav-areas.ts) say where you are; types say what a thing is. Every surface (sidebar, Quick Create,
 * Cmd+K, tables, pickers, dialogs) reads the tone from here, never an ad-hoc palette class.
 * Brand marks (Playwright, k6, Chrome) keep their own colours; their type tone tints the chip and text around them.
 */
export const TYPE_TONES = ["rose", "clay", "gold", "olive", "lime", "jade", "mint", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "steel", "sand", "stone", "taupe"] as const;
export type TypeTone = (typeof TYPE_TONES)[number];

export const TYPE_TONE = {
  test: { browser: "sky", api: "teal", database: "jade", custom: "indigo", performance: "fuchsia" },
  monitor: { http_request: "blue", website: "cyan", ping_host: "olive", port_check: "gold", synthetic_test: "violet" },
  // A job runs a test engine, so it shares the tone of that test type.
  job: { playwright: "sky", k6: "fuchsia" },
  variable: { variable: "lime", secret: "rose", file: "clay" },
  sre: { service: "mint", integration: "purple", privateAgent: "steel" },
  admin: { project: "sand", member: "stone", cliToken: "taupe" },
} as const satisfies Record<string, Record<string, TypeTone>>;

type Group = keyof typeof TYPE_TONE;
type Key<G extends Group> = keyof (typeof TYPE_TONE)[G] & string;

// Static class strings so Tailwind can see them.
export const TYPE_TEXT: Record<TypeTone, string> = {
  rose: "text-type-rose",
  clay: "text-type-clay",
  gold: "text-type-gold",
  olive: "text-type-olive",
  lime: "text-type-lime",
  jade: "text-type-jade",
  mint: "text-type-mint",
  teal: "text-type-teal",
  cyan: "text-type-cyan",
  sky: "text-type-sky",
  blue: "text-type-blue",
  indigo: "text-type-indigo",
  violet: "text-type-violet",
  purple: "text-type-purple",
  fuchsia: "text-type-fuchsia",
  steel: "text-type-steel",
  sand: "text-type-sand",
  stone: "text-type-stone",
  taupe: "text-type-taupe",
};

/** Same colour with `!`, for sidebar and command items whose button sets the svg colour. */
export const TYPE_TEXT_FORCE: Record<TypeTone, string> = {
  rose: "!text-type-rose",
  clay: "!text-type-clay",
  gold: "!text-type-gold",
  olive: "!text-type-olive",
  lime: "!text-type-lime",
  jade: "!text-type-jade",
  mint: "!text-type-mint",
  teal: "!text-type-teal",
  cyan: "!text-type-cyan",
  sky: "!text-type-sky",
  blue: "!text-type-blue",
  indigo: "!text-type-indigo",
  violet: "!text-type-violet",
  purple: "!text-type-purple",
  fuchsia: "!text-type-fuchsia",
  steel: "!text-type-steel",
  sand: "!text-type-sand",
  stone: "!text-type-stone",
  taupe: "!text-type-taupe",
};

/** Tinted square for IconChip (same 10% fill as the area chips). */
export const TYPE_CHIP: Record<TypeTone, string> = {
  rose: "bg-type-rose/10 text-type-rose",
  clay: "bg-type-clay/10 text-type-clay",
  gold: "bg-type-gold/10 text-type-gold",
  olive: "bg-type-olive/10 text-type-olive",
  lime: "bg-type-lime/10 text-type-lime",
  jade: "bg-type-jade/10 text-type-jade",
  mint: "bg-type-mint/10 text-type-mint",
  teal: "bg-type-teal/10 text-type-teal",
  cyan: "bg-type-cyan/10 text-type-cyan",
  sky: "bg-type-sky/10 text-type-sky",
  blue: "bg-type-blue/10 text-type-blue",
  indigo: "bg-type-indigo/10 text-type-indigo",
  violet: "bg-type-violet/10 text-type-violet",
  purple: "bg-type-purple/10 text-type-purple",
  fuchsia: "bg-type-fuchsia/10 text-type-fuchsia",
  steel: "bg-type-steel/10 text-type-steel",
  sand: "bg-type-sand/10 text-type-sand",
  stone: "bg-type-stone/10 text-type-stone",
  taupe: "bg-type-taupe/10 text-type-taupe",
};

/** Hover border for picker cards. */
export const TYPE_HOVER_BORDER: Record<TypeTone, string> = {
  rose: "hover:border-type-rose/50",
  clay: "hover:border-type-clay/50",
  gold: "hover:border-type-gold/50",
  olive: "hover:border-type-olive/50",
  lime: "hover:border-type-lime/50",
  jade: "hover:border-type-jade/50",
  mint: "hover:border-type-mint/50",
  teal: "hover:border-type-teal/50",
  cyan: "hover:border-type-cyan/50",
  sky: "hover:border-type-sky/50",
  blue: "hover:border-type-blue/50",
  indigo: "hover:border-type-indigo/50",
  violet: "hover:border-type-violet/50",
  purple: "hover:border-type-purple/50",
  fuchsia: "hover:border-type-fuchsia/50",
  steel: "hover:border-type-steel/50",
  sand: "hover:border-type-sand/50",
  stone: "hover:border-type-stone/50",
  taupe: "hover:border-type-taupe/50",
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
