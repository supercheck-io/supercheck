"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import {
  ArrowRight,
  Building2,
  Check,
  Container,
  Copy,
  GitBranch,
  Globe,
  Zap,
  Moon,
  Sun,
  Tally4,
  ChartSpline,
  BookOpenText,
  Chromium,
  Sparkles,
  Terminal,
  Search,
} from "lucide-react";
import { SiteFooter } from "../../components/site-footer";

const CLI_INSTALL = "npm install -g @supercheck/cli";

const features = [
  {
    icon: Sparkles,
    title: "AI-Powered",
    description:
      "Create, debug, and analyze Playwright tests, k6 scripts, and monitors with AI assistance.",
  },
  {
    icon: Terminal,
    title: "Supercheck CLI",
    description:
      "Define tests, monitors, and jobs in code. Deploy with supercheck deploy, integrate with any CI/CD pipeline.",
  },
  {
    icon: Zap,
    title: "Parallel Execution",
    description:
      "Lightning-fast test execution with intelligent parallel processing and job orchestration.",
  },
  {
    icon: Chromium,
    title: "Multi-Test Automation",
    description:
      "Browser, API, database, and custom tests across Chromium, Firefox, and WebKit.",
  },
  {
    icon: Globe,
    title: "Real-time Monitoring",
    description:
      "Continuous monitoring with real-time alerts and comprehensive dashboard reporting.",
  },
  {
    icon: Tally4,
    title: "Status Pages",
    description:
      "Public and private status pages with real-time incident updates and subscriber notifications.",
  },
  {
    icon: ChartSpline,
    title: "k6 Performance Testing",
    description:
      "Run k6 load tests from multiple global regions with real-time streaming logs.",
  },
  {
    icon: Container,
    title: "Docker Deployment",
    description:
      "Easy deployment with Docker support and scalable distributed architecture.",
  },
  {
    icon: GitBranch,
    title: "CI/CD Integration",
    description:
      "Seamless integration with CI/CD workflows and comprehensive test reporting.",
  },
  {
    icon: Building2,
    title: "Multi-Organization",
    description:
      "Multi-organization and multi-project architecture with unified role management.",
  },
];

const navLinkClass =
  "p-2 md:px-3 md:py-2 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent/80 transition-colors";

function LandingAtmosphere() {
  return (
    <div className="landing-atmosphere" aria-hidden="true">
      <div className="landing-atmosphere__wash" />
      <div className="landing-atmosphere__grid" />
      <div className="landing-atmosphere__dots" />
    </div>
  );
}

function CliCopyBox() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLI_INSTALL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in insecure contexts
    }
  };

  return (
    <div className="relative z-10 mx-auto mt-8 w-full max-w-xl animate-fade-in-up [animation-delay:500ms]">
      <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-background shadow-sm ring-1 ring-fd-foreground/[0.04]">
        <div className="flex items-center justify-between gap-3 border-b border-fd-border bg-fd-secondary/80 px-3.5 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-fd-muted-foreground">
            <Terminal className="size-3.5 opacity-70" />
            <span>Quick start</span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary/40"
            aria-label={copied ? "Copied" : "Copy install command"}
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">
                  Copied
                </span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        <div className="flex items-start gap-3 bg-fd-background px-3.5 py-3.5 font-mono text-[13px] leading-relaxed sm:text-sm">
          <span className="shrink-0 select-none text-fd-primary/80">$</span>
          <code className="min-w-0 break-all text-left text-fd-foreground">
            {CLI_INSTALL}
          </code>
        </div>
      </div>

      <p className="mt-3 text-sm text-fd-muted-foreground">
        Then run{" "}
        <code className="rounded-md border border-fd-border bg-fd-background px-1.5 py-0.5 font-mono text-[12px] text-fd-foreground">
          supercheck init
        </code>
        <span className="mx-2 text-fd-border">·</span>
        <Link
          href="/docs/cli/installation"
          className="font-medium text-fd-foreground/80 underline decoration-fd-border underline-offset-4 transition-colors hover:text-fd-foreground hover:decoration-fd-foreground/40"
        >
          CLI docs
        </Link>
      </p>
    </div>
  );
}

function SearchButton() {
  const { setOpenSearch, enabled, hotKey } = useSearchContext();

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenSearch(true)}
        className="hidden items-center gap-2 rounded-lg border border-fd-border/80 bg-fd-secondary/40 px-2.5 py-1.5 text-sm text-fd-muted-foreground transition-colors hover:border-fd-border hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary/40 md:inline-flex"
        aria-label="Open search"
      >
        <Search className="size-3.5 opacity-70" />
        <span className="pr-6">Search docs…</span>
        <span className="ms-auto inline-flex items-center gap-0.5">
          {hotKey.map((k, i) => (
            <kbd
              key={i}
              className="rounded border border-fd-border bg-fd-background px-1.5 py-0.5 font-mono text-[10px] leading-none text-fd-muted-foreground"
            >
              {k.display}
            </kbd>
          ))}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setOpenSearch(true)}
        className="rounded-lg p-2 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary/40 md:hidden"
        aria-label="Open search"
      >
        <Search className="size-5" />
      </button>
    </>
  );
}

export default function HomePage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const YOUTUBE_VIDEO_ID = "A9CzmekuvfI";
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const timer = window.setTimeout(() => setIsMounted(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-fd-background text-fd-foreground">
      <LandingAtmosphere />

      <header className="fixed top-0 right-0 left-0 z-50 border-b border-fd-border/40 bg-fd-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2">
            <Image
              src="/supercheck-logo.png"
              alt="Supercheck"
              width={28}
              height={28}
              className="size-7 rounded-lg"
            />
            <span className="truncate text-lg font-bold text-fd-foreground sm:text-xl">
              Supercheck
            </span>
          </Link>
          <nav
            aria-label="Primary"
            className="flex shrink-0 items-center gap-0.5 sm:gap-1 md:gap-2"
          >
            <SearchButton />
            <Link
              href="/docs/app/welcome"
              className={navLinkClass}
              aria-label="Documentation"
            >
              <BookOpenText className="size-5" />
              <span className="hidden md:inline">Docs</span>
            </Link>
            <a
              href="https://www.npmjs.com/package/@supercheck/cli"
              target="_blank"
              rel="noopener noreferrer"
              className={`${navLinkClass} hidden sm:inline-flex`}
              aria-label="Supercheck CLI on npm"
            >
              <Image
                src="/npm.svg"
                alt="npm"
                className="size-4.5"
                width={18}
                height={18}
              />
              <span className="hidden md:inline">npm</span>
            </a>
            <a
              href="https://github.com/supercheck-io/supercheck"
              target="_blank"
              rel="noopener noreferrer"
              className={navLinkClass}
              aria-label="Star on GitHub"
            >
              <svg
                className="size-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              <span className="hidden lg:inline">Star us on GitHub</span>
            </a>
            <a
              href="https://discord.gg/UVe327CSbm"
              target="_blank"
              rel="noopener noreferrer"
              className={`${navLinkClass} hidden sm:inline-flex`}
              aria-label="Join Discord"
            >
              <svg
                className="size-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
            </a>
            {isMounted && (
              <button
                type="button"
                onClick={() => setTheme(isDark ? "light" : "dark")}
                className="rounded-lg p-2 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary/40"
                aria-label="Toggle theme"
              >
                {isDark ? (
                  <Sun className="size-5" />
                ) : (
                  <Moon className="size-5" />
                )}
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="relative z-10 overflow-hidden">
        <section className="relative">
          <div className="relative pt-28 pb-12">
            <div className="relative z-20 mx-auto max-w-6xl px-6">
              <div className="mx-auto max-w-5xl text-center">
                <div className="mx-auto animate-fade-in-up">
                  <Link
                    href="https://demo.supercheck.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group mx-auto flex w-fit items-center gap-4 rounded-full border border-fd-border/80 bg-fd-background/70 px-4 py-2 shadow-sm shadow-fd-foreground/5 backdrop-blur-md transition-colors duration-300 hover:bg-fd-accent/40"
                  >
                    <span className="text-base text-fd-foreground">
                      Checkout Live Demo
                    </span>
                    <span className="block h-4 w-0.5 border-l border-fd-border" />

                    <div className="size-6 overflow-hidden rounded-full bg-red-600 duration-500 group-hover:bg-red-700">
                      <div className="flex w-12 -translate-x-1/2 duration-500 ease-in-out group-hover:translate-x-0">
                        <span className="flex size-6">
                          <ArrowRight className="m-auto size-3 text-white" />
                        </span>
                        <span className="flex size-6">
                          <ArrowRight className="m-auto size-3 text-white" />
                        </span>
                      </div>
                    </div>
                  </Link>
                </div>

                <h1 className="mt-16 animate-fade-in-up text-balance text-4xl leading-tight font-extrabold text-fd-foreground [animation-delay:200ms] md:text-5xl lg:text-6xl">
                  Open-Source Testing, Monitoring, and Reliability —{" "}
                  <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent dark:from-indigo-400 dark:via-purple-400 dark:to-pink-400">
                    as Code
                  </span>
                </h1>

                <p className="mx-auto mt-6 max-w-4xl animate-fade-in-up text-balance text-lg leading-relaxed text-fd-muted-foreground [animation-delay:400ms] md:text-xl">
                  The unified platform for AI-powered Playwright testing,
                  multi-region k6 load testing & uptime monitoring, and
                  subscriber-ready status pages.
                </p>

                <CliCopyBox />
              </div>

              <div className="mx-auto mt-12 max-w-7xl animate-fade-in-up px-2 [animation-delay:600ms] sm:px-4 md:mt-16 md:px-8">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-fd-border bg-fd-secondary shadow-2xl shadow-fd-foreground/5 md:rounded-xl">
                  {isVideoPlaying ? (
                    <iframe
                      src={`https://www.youtube.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                      title="Supercheck Platform Demo"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                      allowFullScreen
                      className="absolute inset-0 h-full w-full"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsVideoPlaying(true)}
                      className="group absolute inset-0 h-full w-full cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-fd-primary/40"
                      aria-label="Play demo video"
                    >
                      <Image
                        src="/supercheck-screenshot.png"
                        alt="Supercheck Platform Demo Video Thumbnail"
                        fill
                        className="object-cover"
                        priority
                      />

                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-70 transition-opacity duration-300 group-hover:opacity-50" />

                      <div className="absolute inset-0 flex items-center justify-center pb-8 md:pb-12">
                        <div className="cursor-pointer transition-transform duration-200 hover:scale-110 active:scale-95">
                          <svg
                            viewBox="0 0 68 48"
                            className="h-12 w-16 drop-shadow-lg transition-transform duration-200 md:h-14 md:w-20"
                          >
                            <path
                              d="M66.52,7.74c-0.78-2.93-2.49-5.41-5.42-6.19C55.79,.13,34,0,34,0S12.21,.13,6.9,1.55 C3.97,2.33,2.27,4.81,1.48,7.74C0.06,13.05,0,24,0,24s0.06,10.95,1.48,16.26c0.78,2.93,2.49,5.41,5.42,6.19 C12.21,47.87,34,48,34,48s21.79-0.13,27.1-1.55c2.93-0.78,4.64-3.26,5.42-6.19C67.94,34.95,68,24,68,24S67.94,13.05,66.52,7.74z"
                              fill="#FF0000"
                            />
                            <path d="M 45,24 27,14 27,34" fill="#FFFFFF" />
                          </svg>
                        </div>
                      </div>

                      <div className="absolute right-0 bottom-3 left-0 flex justify-center md:bottom-6">
                        <span className="rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm md:px-4 md:py-2 md:text-base">
                          Watch Demo
                        </span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-10 py-2">
          <div className="mx-auto max-w-6xl space-y-6 px-6">
            <div className="relative mx-auto grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }, i) => (
                <div
                  key={title}
                  className="animate-fade-in-up space-y-3 rounded-xl border border-fd-border/40 bg-fd-background/80 p-6 backdrop-blur-[2px] transition-colors hover:border-fd-border hover:bg-fd-secondary/30"
                  style={{ animationDelay: `${800 + i * 100}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-fd-primary" />
                    <h3 className="text-sm font-medium">{title}</h3>
                  </div>
                  <p className="text-sm text-fd-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative z-10 py-16 md:py-20">
          <div className="mx-auto max-w-3xl px-6">
            <div className="relative overflow-hidden rounded-2xl border border-fd-border/70 bg-fd-secondary/30 px-6 py-10 text-center sm:px-10 md:py-12">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--color-fd-primary)_12%,transparent),transparent_60%)]"
              />
              <div className="relative">
                <h2 className="text-2xl font-bold tracking-tight text-fd-foreground md:text-3xl">
                  Ready to automate testing & monitoring?
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-fd-muted-foreground">
                  Deploy on your infrastructure in minutes, or start with the
                  docs and CLI.
                </p>
                <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                  <Link
                    href="/docs/app/deployment/self-hosted"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
                  >
                    Self-Hosted Deployment
                    <ArrowRight className="size-4" />
                  </Link>
                  <Link
                    href="/docs/app/welcome"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-fd-border bg-fd-background/80 px-5 py-2.5 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary/40"
                  >
                    Get Started
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
