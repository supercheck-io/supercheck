"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";

/** Click-to-open help, same shape as the app's InfoPopover: a title, 2-5 short bullets and an optional link. */
export function InfoPopover({ label, title, bullets, link }: { label: string; title: string; bullets: string[]; link?: { href: string; label: string } }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="inline-flex size-6 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-fd-primary"
      >
        <Info className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={label} className="w-80 bg-fd-popover p-4 shadow-sm backdrop-blur-none">
        <p className="font-semibold">{title}</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-fd-muted-foreground marker:text-fd-border">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        {link && (
          <Link href={link.href} className="mt-3 inline-block font-medium text-fd-primary hover:underline">
            {link.label}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
