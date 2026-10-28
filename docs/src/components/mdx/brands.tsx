import { brands, type BrandName } from "../brand-data";

// Wordmarks (wider than 2:1) already spell the name, so they render at text height without a label.
const isWordmark = (name: BrandName) => {
  const [, , w, h] = brand(name).viewBox.split(" ").map(Number);
  return w / h > 2;
};

// Logos with dark brand fills sit on a light chip in dark mode so they stay visible.
const darkFill = new Set<BrandName>(["sentry", "opensearch", "new-relic", "webhook", "elasticsearch"]);

function brand(name: BrandName) {
  const entry = brands[name];
  // MDX props are not type-checked, so fail the build with a clear message on a typo.
  if (!entry) throw new Error(`Unknown brand "${name}" (see brand-data.ts)`);
  return entry;
}

/** Logo alone. Decorative by default; pass `title` when no visible text names the brand. */
export function BrandMark({ name, className, title }: { name: BrandName; className?: string; title?: string }) {
  const { viewBox, body } = brand(name);
  const chip = darkFill.has(name) ? " dark:rounded-[3px] dark:bg-white dark:p-px" : "";
  return (
    <svg
      viewBox={viewBox}
      className={`${className ?? (isWordmark(name) ? "h-3.5 w-auto" : "size-4")} shrink-0${chip}`}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      // Static, trusted CC0 SVG markup from brand-data.ts.
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

/** Inline brand chip: logo + name. `label` overrides the default name, e.g. "Azure Log Analytics". */
export function Brand({ name, label }: { name: BrandName; label?: string }) {
  const showLabel = label !== undefined || !isWordmark(name);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap align-middle">
      <BrandMark name={name} title={showLabel ? undefined : brand(name).label} />
      {showLabel && <span>{label ?? brand(name).label}</span>}
    </span>
  );
}

/** A wrapped row of brand chips, for provider lists. */
export function Brands({ names, labels = {} }: { names: BrandName[]; labels?: Partial<Record<BrandName, string>> }) {
  return (
    <span className="not-prose flex flex-wrap gap-x-4 gap-y-2">
      {names.map((name) => (
        <Brand key={name} name={name} label={labels[name]} />
      ))}
    </span>
  );
}
