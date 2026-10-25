"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from "fumadocs-ui/components/ui/navigation-menu";
import { ArrowRight, ChevronDown, Menu, Search, X } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { DEMO_URL, GITHUB_URL, isExternal, navMenus, type NavItem, type NavMenu } from "../lib/site-nav";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";

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
      className={`${focusRing} inline-flex items-center gap-2 rounded-md p-2 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground lg:border lg:border-fd-border lg:px-2.5 lg:py-1.5`}
      aria-label="Search docs"
    >
      <Search className="size-4" aria-hidden="true" />
      <span className="hidden pr-4 lg:inline">Search docs</span>
      <span className="hidden items-center gap-0.5 lg:inline-flex">
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

// Spreads the props and ref that Radix's NavigationMenuLink (asChild) injects, so clicking an item dismisses the menu.
function ItemLink({
  item,
  onSelect,
  children,
  ...rest
}: { item: NavItem; onSelect?: () => void; children: React.ReactNode } & Omit<React.ComponentProps<"a">, "href">) {
  const props = {
    ...rest,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      rest.onClick?.(event);
      onSelect?.();
    },
  };
  if (isExternal(item.href)) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={item.href} {...props}>
      {children}
    </Link>
  );
}

function MenuItemBody({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-fd-muted-foreground transition-colors group-hover:text-fd-primary" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fd-foreground">{item.title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-fd-muted-foreground">{item.description}</span>
      </span>
    </>
  );
}

const menuItemClass = `${focusRing} group flex gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-fd-accent`;

function DesktopMenuPanel({ menu }: { menu: NavMenu }) {
  // Product groups flow across two columns; single-group menus lay their items out in two columns.
  const multiGroup = menu.groups.length > 1;
  return (
    <div
      className={`p-4 ${multiGroup ? "w-[min(58rem,calc(100vw-2rem))] columns-3 gap-x-4" : "w-[min(36rem,calc(100vw-2rem))]"}`}
    >
      {menu.groups.map((group) => (
        <div key={group.title} className="mb-4 break-inside-avoid last:mb-0">
          <p className="px-2.5 pb-1.5 text-xs font-medium text-fd-muted-foreground">{group.title}</p>
          <ul className={multiGroup ? "space-y-0.5" : "grid grid-cols-2 gap-0.5"}>
            {group.items.map((item) => (
              <li key={item.href}>
                <NavigationMenuLink asChild>
                  <ItemLink item={item} className={menuItemClass}>
                    <MenuItemBody item={item} />
                  </ItemLink>
                </NavigationMenuLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DesktopNav({ pathname }: { pathname: string | null }) {
  const pricingActive = pathname?.startsWith("/pricing");
  return (
    <NavigationMenu aria-label="Primary" className="hidden md:block">
      <NavigationMenuList className="flex items-center gap-1">
        {navMenus.map((menu) => (
          <NavigationMenuItem key={menu.label}>
            <NavigationMenuTrigger
              className={`${focusRing} group inline-flex items-center gap-1 rounded-md px-2 py-1.5 lg:px-3 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground data-[state=open]:text-fd-foreground`}
            >
              {menu.label}
              <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </NavigationMenuTrigger>
            {/* Panels are sized to fit without scrolling; overflow-x-hidden keeps a scrollbar from adding a second one. */}
            <NavigationMenuContent className="relative max-h-[calc(100svh-5rem)] w-max overflow-x-hidden">
              <DesktopMenuPanel menu={menu} />
            </NavigationMenuContent>
          </NavigationMenuItem>
        ))}
        <NavigationMenuItem>
          <NavigationMenuLink asChild>
            <Link
              href="/pricing"
              aria-current={pricingActive ? "page" : undefined}
              className={`${focusRing} inline-flex rounded-md px-2 py-1.5 text-sm transition-colors lg:px-3 hover:text-fd-foreground ${
                pricingActive ? "text-fd-foreground" : "text-fd-muted-foreground"
              }`}
            >
              Pricing
            </Link>
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
      {/* Centred under the header; the header is the positioned ancestor. */}
      <div className="absolute inset-x-0 top-full flex justify-center px-4">
        <NavigationMenuViewport className="site-nav-viewport mt-2 box-content w-(--radix-navigation-menu-viewport-width) rounded-xl border border-fd-border bg-fd-popover text-fd-popover-foreground shadow-lg" />
      </div>
    </NavigationMenu>
  );
}

function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div
      id="mobile-nav"
      hidden={!open}
      className="absolute inset-x-0 top-full max-h-[calc(100svh-3.5rem)] overflow-y-auto border-b border-fd-border bg-fd-background md:hidden"
    >
      <nav aria-label="Mobile" className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6">
        {navMenus.map((menu) => (
          <section key={menu.label} aria-labelledby={`mobile-${menu.label}`}>
            <h2 id={`mobile-${menu.label}`} className="text-sm font-semibold">{menu.label}</h2>
            {menu.groups.map((group) => (
              <div key={group.title} className="mt-3">
                {menu.groups.length > 1 && <p className="text-xs font-medium text-fd-muted-foreground">{group.title}</p>}
                <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <ItemLink item={item} onSelect={onClose} className={menuItemClass}>
                        <MenuItemBody item={item} />
                      </ItemLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
        <div className="flex flex-col gap-3 border-t border-fd-border pt-5">
          <Link href="/pricing" onClick={onClose} className={`${focusRing} rounded-md text-sm font-semibold`}>
            Pricing
          </Link>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${focusRing} inline-flex items-center justify-center gap-2 rounded-md bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground`}
          >
            Try the live demo
            <ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </div>
      </nav>
    </div>
  );
}

/** Shared header for the marketing pages (home, pricing, solutions, terms, privacy). */
export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Same-route links keep the page mounted, so return focus to the toggle instead of the hidden panel.
  const closeMobile = () => {
    setMobileOpen(false);
    document.getElementById("mobile-nav-toggle")?.focus();
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobile();
    };
    // The panel is md:hidden; close it so it does not reappear open after a resize.
    const desktop = window.matchMedia("(min-width: 768px)");
    const onDesktop = () => desktop.matches && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onDesktop);
    return () => {
      window.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [mobileOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-fd-border bg-fd-background/95 supports-[backdrop-filter]:bg-fd-background/80 supports-[backdrop-filter]:backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 lg:gap-6">
          <Link href="/" className={`${focusRing} flex shrink-0 items-center gap-2 rounded-md`} aria-label="Supercheck home">
            <Image src="/supercheck-logo.png" alt="" width={24} height={24} className="rounded-md" />
            <span className="text-[17px] font-semibold tracking-tight">Supercheck</span>
          </Link>
          <DesktopNav pathname={pathname} />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <SearchButton />
          <a
            href={GITHUB_URL}
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
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${focusRing} ml-1 hidden rounded-md bg-fd-primary px-3 py-1.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90 lg:inline-flex`}
          >
            Live demo
          </a>
          <button
            type="button"
            id="mobile-nav-toggle"
            onClick={() => setMobileOpen((value) => !value)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className={`${focusRing} inline-flex rounded-md p-2 text-fd-muted-foreground transition-colors hover:text-fd-foreground md:hidden`}
          >
            {mobileOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <MobileNav open={mobileOpen} onClose={closeMobile} />
    </header>
  );
}
