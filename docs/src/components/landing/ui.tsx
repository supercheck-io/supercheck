import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, type LucideIcon } from "lucide-react";
import { versioned } from "../../lib/assets";
import { solutionsMenu } from "../../lib/site-nav";
import type { SolutionStep } from "../../lib/solutions";
import { CodeWindow } from "./code-window";

export { primaryButton, secondaryButton, textLink } from "./buttons";

/** Product areas from DESIGN.md; each maps to a colour token in global.css. */
export type Area = "automate" | "monitor" | "respond" | "communicate" | "ai";

const AREA_TEXT: Record<Area, string> = {
  automate: "text-automate",
  monitor: "text-monitor",
  respond: "text-respond",
  communicate: "text-communicate",
  ai: "text-ai",
};

const AREA_CHIP: Record<Area, string> = {
  automate: "bg-automate/10 text-automate",
  monitor: "bg-monitor/10 text-monitor",
  respond: "bg-respond/10 text-respond",
  communicate: "bg-communicate/10 text-communicate",
  ai: "bg-ai/10 text-ai",
};

/** Tinted square holding an icon, as in the app. Decorative only. */
export function IconChip({ icon: Icon, area, className = "" }: { icon: LucideIcon; area: Area; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${AREA_CHIP[area]} ${className}`}>
      <Icon className="size-[18px]" />
    </span>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <p className="text-sm font-medium text-fd-muted-foreground">{eyebrow}</p>}
      <h2 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {children && <p className="mt-3 text-pretty text-fd-muted-foreground">{children}</p>}
    </div>
  );
}

export function CheckList({ items, area, className = "" }: { items: string[]; area?: Area; className?: string }) {
  return (
    <ul className={`space-y-2.5 text-sm ${className}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <Check className={`mt-0.5 size-4 shrink-0 ${area ? AREA_TEXT[area] : "text-fd-muted-foreground"}`} aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Product screenshot in a framed panel. Every site screenshot is a full 1600x969 dark-theme capture, so all frames match. */
export function Screenshot({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-[#0a0a0a] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_24px_48px_-24px_rgb(0_0_0/0.3)]">
      <Image
        src={versioned(src)}
        alt={alt}
        width={1600}
        height={969}
        sizes="(min-width: 1024px) 640px, 100vw"
        className="h-auto w-full"
        priority={priority}
      />
    </div>
  );
}

/** Role cards linking to the solutions pages; `exclude` drops the page being viewed. */
export function SolutionCards({ exclude, className = "" }: { exclude?: string; className?: string }) {
  const items = solutionsMenu.groups[0].items.filter((item) => item.href !== exclude);
  return (
    <ul className={`grid gap-4 sm:grid-cols-2 ${items.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"} ${className}`}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className="group flex h-full flex-col rounded-xl border border-fd-border bg-fd-background p-6 transition-colors hover:border-fd-foreground/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
            >
              <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-lg bg-fd-muted text-fd-foreground">
                <Icon className="size-[18px]" />
              </span>
              <span className="mt-4 font-semibold">{item.title}</span>
              <span className="mt-1.5 flex-1 text-sm leading-relaxed text-fd-muted-foreground">{item.description}</span>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-fd-primary">
                Learn more
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Right-hand visual of a how-it-works step: code, screenshot, or the bullet list when there is no visual. */
export function StepVisual({ step }: { step: SolutionStep }) {
  const visual = step.visual;
  if (!visual) {
    // Text-only steps show their details in the visual column instead.
    return (
      <div className="rounded-xl border border-fd-border bg-fd-card p-6 sm:p-8">
        <CheckList items={step.bullets} />
      </div>
    );
  }
  if (visual.kind === "code") {
    return <CodeWindow code={visual.code} filename={visual.filename} lang={visual.lang} />;
  }
  return <Screenshot src={visual.src} alt={visual.alt} />;
}
