"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Container,
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
} from "lucide-react";
import { SiteFooter } from "../../components/site-footer";


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



export default function HomePage() {
  const [isDark, setIsDark] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  // YouTube Video ID from the provided URL
  const YOUTUBE_VIDEO_ID = "A9CzmekuvfI";

  useEffect(() => {
    setIsMounted(true);
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    if (isDark) {
      html.classList.remove("dark");
      localStorage.setItem("theme", "light");
      setIsDark(false);
    } else {
      html.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setIsDark(true);
    }
  };

  return (
    <div className="min-h-screen w-full bg-white dark:bg-gray-950 relative text-gray-800 dark:text-gray-100">
      {/* Circuit Board - Light Pattern with Fade */}
      <div
        className="fixed inset-0 z-0 pointer-events-none dark:hidden"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(75, 85, 99, 0.08) 19px, rgba(75, 85, 99, 0.08) 20px, transparent 20px, transparent 39px, rgba(75, 85, 99, 0.08) 39px, rgba(75, 85, 99, 0.08) 40px),
            repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(75, 85, 99, 0.08) 19px, rgba(75, 85, 99, 0.08) 20px, transparent 20px, transparent 39px, rgba(75, 85, 99, 0.08) 39px, rgba(75, 85, 99, 0.08) 40px),
            radial-gradient(circle at 20px 20px, rgba(55, 65, 81, 0.12) 2px, transparent 2px),
            radial-gradient(circle at 40px 40px, rgba(55, 65, 81, 0.12) 2px, transparent 2px)
          `,
          backgroundSize: "40px 40px, 40px 40px, 40px 40px, 40px 40px",
          WebkitMaskImage:
            "radial-gradient(ellipse 65% 55% at 50% 45%, #000 50%, rgba(0,0,0,0.6) 75%, transparent 100%)",
          maskImage:
            "radial-gradient(ellipse 65% 55% at 50% 45%, #000 50%, rgba(0,0,0,0.6) 75%, transparent 100%)",
        }}
      />
      {/* Circuit Board - Dark Pattern with Fade */}
      <div
        className="fixed inset-0 z-0 pointer-events-none hidden dark:block"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(156, 163, 175, 0.15) 19px, rgba(156, 163, 175, 0.15) 20px, transparent 20px, transparent 39px, rgba(156, 163, 175, 0.15) 39px, rgba(156, 163, 175, 0.15) 40px),
            repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(156, 163, 175, 0.15) 19px, rgba(156, 163, 175, 0.15) 20px, transparent 20px, transparent 39px, rgba(156, 163, 175, 0.15) 39px, rgba(156, 163, 175, 0.15) 40px),
            radial-gradient(circle at 20px 20px, rgba(209, 213, 219, 0.2) 2px, transparent 2px),
            radial-gradient(circle at 40px 40px, rgba(209, 213, 219, 0.2) 2px, transparent 2px)
          `,
          backgroundSize: "40px 40px, 40px 40px, 40px 40px, 40px 40px",
          WebkitMaskImage:
            "radial-gradient(ellipse 65% 55% at 50% 45%, #000 50%, rgba(0,0,0,0.6) 75%, transparent 100%)",
          maskImage:
            "radial-gradient(ellipse 65% 55% at 50% 45%, #000 50%, rgba(0,0,0,0.6) 75%, transparent 100%)",
        }}
      />

      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-200/50 dark:border-gray-800/50">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/supercheck-logo.png"
              alt="Supercheck"
              width={28}
              height={28}
              className="rounded-lg"
            />
            <span className="font-bold text-gray-900 dark:text-white text-xl">
              Supercheck
            </span>
          </Link>
          <div className="flex items-center gap-1 md:gap-4">
            <Link
              href="/docs/app/welcome"
              className="p-2 md:px-3 md:py-2 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              aria-label="Documentation"
            >
              <BookOpenText className="size-5" />
              <span className="hidden md:inline">Docs</span>
            </Link>
            <a
              href="https://www.npmjs.com/package/@supercheck/cli"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 md:px-3 md:py-2 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              aria-label="Supercheck CLI on npm"
            >
              <img src="/npm.svg" alt="npm" className="size-4.5" />
              <span className="hidden md:inline">npm</span>
            </a>
            <a
              href="https://github.com/supercheck-io/supercheck"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 md:px-3 md:py-2 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              aria-label="Star on GitHub"
            >
              <svg className="size-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              <span className="hidden md:inline">Star us on GitHub</span>
            </a>
            <a
              href="https://discord.gg/UVe327CSbm"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 md:px-3 md:py-2 rounded-lg inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              aria-label="Join Discord"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
              {/* <span className="hidden md:inline">Discord</span> */}
            </a>
            {isMounted && (
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                aria-label="Toggle theme"
              >
                {isDark ? (
                  <Sun className="size-5" />
                ) : (
                  <Moon className="size-5" />
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative overflow-hidden">
        <section className="relative z-10">
          <div className="relative pt-28 pb-12">
            <div className="mx-auto max-w-6xl px-6 relative z-20">
              <div className="text-center mx-auto max-w-5xl">
                <div
                  className="mx-auto animate-fade-in-up"
                >
                  <Link
                    href="https://demo.supercheck.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group mx-auto flex w-fit items-center gap-4 rounded-full border border-gray-200 dark:border-white/10 bg-white/60 dark:bg-zinc-900/50 px-4 py-2 shadow-md shadow-zinc-950/5 transition-colors duration-300 hover:bg-white/80 dark:hover:bg-zinc-800/50 dark:shadow-zinc-950 backdrop-blur-md"
                  >
                    <span className="text-base text-gray-900 dark:text-gray-100">
                      Checkout Live Demo
                    </span>
                    <span className="dark:bg-zinc-600 block h-4 w-0.5 border-l border-gray-300 bg-white dark:border-gray-600"></span>

                    <div className="bg-red-600 group-hover:bg-red-700 size-6 overflow-hidden rounded-full duration-500">
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

                <h1
                  className="mt-16 text-balance text-4xl font-extrabold leading-tight text-gray-900 dark:text-white md:text-5xl lg:text-6xl animate-fade-in-up [animation-delay:200ms]"
                >
                  Open-Source Testing, Monitoring, and Reliability — <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 dark:from-indigo-400 dark:via-purple-400 dark:to-pink-400">as Code</span>
                </h1>

                <p
                  className="mx-auto mt-6 max-w-4xl text-balance text-lg md:text-xl leading-relaxed text-gray-600 dark:text-gray-300 animate-fade-in-up [animation-delay:400ms]"
                >
                  The unified platform for AI-powered Playwright testing, multi-region k6 load testing & uptime monitoring, and subscriber-ready status pages.
                </p>

              </div>

              {/* YouTube Video Demo - Full Width */}
              <div
                className="mt-12 md:mt-16 mx-auto max-w-7xl px-2 sm:px-4 md:px-8 animate-fade-in-up [animation-delay:600ms]"
              >
                <div className="relative w-full aspect-video rounded-lg md:rounded-xl border border-gray-200 dark:border-gray-800 shadow-2xl overflow-hidden bg-gray-900">
                  {isVideoPlaying ? (
                    // YouTube iframe - loads only when play is clicked
                    <iframe
                      src={`https://www.youtube.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
                      title="Supercheck Platform Demo"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                      allowFullScreen
                      className="absolute inset-0 w-full h-full"
                    />
                  ) : (
                    // Thumbnail with play button - shown initially for fast loading
                    <button
                      onClick={() => setIsVideoPlaying(true)}
                      className="group absolute inset-0 w-full h-full cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/50"
                      aria-label="Play demo video"
                    >
                      {/* Video thumbnail */}
                      <Image
                        src="/supercheck-screenshot.png"
                        alt="Supercheck Platform Demo Video Thumbnail"
                        fill
                        className="object-cover"
                        priority
                      />

                      {/* Gradient overlay for better play button visibility */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-70 group-hover:opacity-50 transition-opacity duration-300" />

                      {/* YouTube play button - clean and professional */}
                      <div className="absolute inset-0 flex items-center justify-center pb-8 md:pb-12">
                        <div
                          className="cursor-pointer hover:scale-110 active:scale-95 transition-transform duration-200"
                        >
                          {/* Custom YouTube-style play button SVG */}
                          <svg
                            viewBox="0 0 68 48"
                            className="w-16 h-12 md:w-20 md:h-14 drop-shadow-lg transition-transform duration-200"
                          >
                            {/* Red rounded rectangle background */}
                            <path
                              d="M66.52,7.74c-0.78-2.93-2.49-5.41-5.42-6.19C55.79,.13,34,0,34,0S12.21,.13,6.9,1.55 C3.97,2.33,2.27,4.81,1.48,7.74C0.06,13.05,0,24,0,24s0.06,10.95,1.48,16.26c0.78,2.93,2.49,5.41,5.42,6.19 C12.21,47.87,34,48,34,48s21.79-0.13,27.1-1.55c2.93-0.78,4.64-3.26,5.42-6.19C67.94,34.95,68,24,68,24S67.94,13.05,66.52,7.74z"
                              fill="#FF0000"
                            />
                            {/* White play triangle */}
                            <path d="M 45,24 27,14 27,34" fill="#FFFFFF" />
                          </svg>
                        </div>
                      </div>

                      {/* "Watch Demo" text - positioned below play button */}
                      <div className="absolute bottom-3 md:bottom-6 left-0 right-0 flex justify-center">
                        <span className="text-xs md:text-base font-medium text-white/90 bg-black/40 backdrop-blur-sm px-3 py-1.5 md:px-4 md:py-2 rounded-full">
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

        <section className="py-2 mb-10">
          <div className="mx-auto max-w-6xl space-y-6 px-6">
            <div
              className="relative mx-auto grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
            >
              {features.map(({ icon: Icon, title, description }, i) => (
                <div
                  key={title}
                  className="rounded-lg border border-gray-200/30 dark:border-gray-800/30 bg-white/95 dark:bg-gray-950/95 p-6 space-y-3 animate-fade-in-up"
                  style={{ animationDelay: `${800 + i * 100}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-4" />
                    <h3 className="text-sm font-medium">{title}</h3>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
