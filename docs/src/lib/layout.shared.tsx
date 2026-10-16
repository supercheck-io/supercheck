import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import Link from 'next/link';

// Custom filled GitHub icon (matches homepage style)
export const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

export const NpmIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 256 256" className={className ?? "size-4 text-[#CB3837]"} aria-hidden="true">
    <rect width="256" height="256" fill="#CB3837" />
    <path
      d="M48 64h160v128h-32V96h-32v96h-32V96h-32v96H80V96H48V64z"
      fill="#ffffff"
    />
  </svg>
);

// Shared site header for standalone pages (terms, privacy, pricing)
interface SiteHeaderProps {
  showPricing?: boolean;
  showDocs?: boolean;
}

export function SiteHeader({ showPricing = true, showDocs = true }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-fd-border bg-fd-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <Image
            src="/supercheck-logo.png"
            alt="Supercheck Logo"
            width={28}
            height={28}
            className="rounded-md"
          />
          <span className="hidden truncate text-xl font-bold min-[375px]:inline">Supercheck</span>
        </Link>
        <nav aria-label="Site navigation" className="flex shrink-0 items-center gap-4">
          {showDocs && (
            <Link href="/docs/app/welcome" className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors">
              Docs
            </Link>
          )}
          {showPricing && (
            <Link href="/pricing" className="text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors">
              Pricing
            </Link>
          )}
          <Link
            href="https://www.npmjs.com/package/@supercheck/cli"
            className="text-fd-muted-foreground hover:text-fd-foreground transition-colors inline-flex items-center gap-2"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Supercheck CLI on npm"
          >
            <Image src="/npm.svg" alt="npm" className="size-4.5 rounded-sm" width={18} height={18} />
            <span className="hidden md:inline">npm</span>
          </Link>
          <Link
            href="https://github.com/supercheck-io/supercheck"
            aria-label="GitHub"
            className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubIcon />
          </Link>
        </nav>
      </div>
    </header>
  );
}

export const linkItems: LinkItemType[] = [
  {
    type: 'icon',
    text: 'GitHub',
    url: 'https://github.com/supercheck-io/supercheck',
    icon: <GitHubIcon />,
    external: true,
  },
];

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Image
            src="/supercheck-logo.png"
            alt="Supercheck Logo"
            width={28}
            height={28}
            className="rounded-md"
          />
          <span className="font-bold text-xl">Supercheck</span>
        </>
      ),
    },
    links: linkItems,
  };
}
