"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { Search } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";

const navLinks = [
  { href: "/docs/app/welcome", label: "Docs", match: "/docs" },
  { href: "/pricing", label: "Pricing", match: "/pricing" },
];

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function SearchButton() {
  const { setOpenSearch, enabled, hotKey } = useSearchContext();
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => setOpenSearch(true)}
      className="inline-flex items-center gap-2 rounded-md p-2 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary md:border md:border-fd-border md:px-2.5 md:py-1.5"
      aria-label="Search docs"
    >
      <Search className="size-4" aria-hidden="true" />
      <span className="hidden pr-4 md:inline">Search docs</span>
      <span className="hidden items-center gap-0.5 md:inline-flex">
        {hotKey.map((k, i) => (
          <kbd
            key={i}
            className="rounded border border-fd-border px-1 font-mono text-[10px] leading-4 text-fd-muted-foreground"
          >
            {k.display}
          </kbd>
        ))}
      </span>
    </button>
  );
}

/** Shared header for the marketing pages (home, pricing, terms, privacy). */
export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-fd-border bg-fd-background/95 supports-[backdrop-filter]:bg-fd-background/80 supports-[backdrop-filter]:backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" className={`${focusRing} flex shrink-0 items-center gap-2 rounded-md`} aria-label="Supercheck home">
            <Image src="/supercheck-logo.png" alt="" width={24} height={24} className="rounded-md" />
            {/* The wordmark plus the mobile links need ~410px; narrower phones keep the logo (link is aria-labelled). */}
            <span className="hidden text-[17px] font-semibold tracking-tight min-[410px]:inline">Supercheck</span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
            {navLinks.map((link) => {
              const active = pathname?.startsWith(link.match);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`${focusRing} rounded-sm text-sm transition-colors hover:text-fd-foreground ${
                    active ? "text-fd-foreground" : "text-fd-muted-foreground"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <SearchButton />
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname?.startsWith(link.match) ? "page" : undefined}
              className={`${focusRing} rounded-md p-2 text-sm text-fd-muted-foreground hover:text-fd-foreground sm:hidden`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/supercheck-io/supercheck"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Supercheck on GitHub"
            className={`${focusRing} inline-flex rounded-md p-2 text-fd-muted-foreground transition-colors hover:text-fd-foreground`}
          >
            <GitHubMark />
          </a>
          <ThemeToggle
            className={`${focusRing} inline-flex rounded-md p-2 text-fd-muted-foreground transition-colors hover:text-fd-foreground`}
          />
        </div>
      </div>
    </header>
  );
}
