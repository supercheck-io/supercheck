'use client';

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  Container,
  Database,
  GitBranch,
  Globe,
  Shield,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Parallel Execution",
    description:
      "Lightning-fast test execution with intelligent parallel processing and job orchestration.",
  },
  {
    icon: Globe,
    title: "Multi-Browser Testing",
    description:
      "Playwright-based testing across multiple browsers with comprehensive browser support.",
  },
  {
    icon: Activity,
    title: "Real-time Monitoring",
    description:
      "Continuous monitoring with real-time alerts and comprehensive dashboard reporting.",
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description:
      "Role-based access control with secure session management and granular permissions.",
  },
  {
    icon: Database,
    title: "Multi-Test Types",
    description:
      "Support for browser, API, database, and custom tests in a unified platform.",
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
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-50">
      <div
        className="pointer-events-none absolute inset-0 z-0 hidden dark:block"
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
      <div
        className="pointer-events-none absolute inset-0 z-0 dark:hidden"
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

      <main className="relative z-10">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 pt-10">
          <div className="flex items-center gap-3">
            <Image
              src="/supercheck-logo.png"
              alt="Supercheck logo"
              width={40}
              height={40}
              className={`h-10 w-10 rounded-lg border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${
                isMounted ? "animate-fade-in" : "opacity-0"
              }`}
            />
            <span
              className={`text-lg font-semibold tracking-tight ${
                isMounted ? "animate-slide-up-delayed" : "opacity-0 translate-y-2"
              }`}
            >
              Supercheck Docs
            </span>
          </div>
          <Link
            href="/docs"
            className={`flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 ${
              isMounted ? "animate-slide-up" : "opacity-0 translate-y-2"
            }`}
          >
            Explore Documentation
            <ArrowRight className="h-4 w-4" />
          </Link>
        </header>

        <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-16 pt-16 text-center md:pt-24">
          <Link
            href="https://demo.supercheck.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-full border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-200 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200 dark:hover:bg-gray-800"
            data-animate
          >
            Checkout Live Demo
            <ArrowRight className="h-4 w-4" />
          </Link>
          <h1
            className={`mt-12 text-balance text-4xl font-bold leading-tight tracking-tight text-gray-900 dark:text-white md:text-5xl lg:text-6xl ${
              isMounted ? "animate-fade-in" : "opacity-0"
            }`}
          >
            AI-Powered Automation & Monitoring for Modern Apps
          </h1>
          <p
            className={`mt-6 max-w-3xl text-balance text-lg leading-relaxed text-gray-600 dark:text-gray-300 ${
              isMounted ? "animate-fade-in-delayed" : "opacity-0"
            }`}
          >
            Empowering development and SRE teams with a scalable, distributed,
            and robust platform to drive faster delivery and higher software
            quality.
          </p>

          <div
            className={`mt-10 flex flex-wrap items-center justify-center gap-3 ${
              isMounted ? "animate-slide-up" : "opacity-0 translate-y-3"
            }`}
          >
            <a
              href="https://github.com/supercheck-io/supercheck"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
            >
              <ArrowRight className="h-4 w-4 -scale-x-100" />
              Star on GitHub
            </a>
            <a
              href="https://www.youtube.com/watch?v=eQ_aCghTpeI&list=PLw76CEQ8n7V6__OFWqtsvsgX1anVmuRk0"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-600 hover:text-white"
            >
              <svg
                className="h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
              >
                <path
                  fill="currentColor"
                  d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
                />
              </svg>
              Watch a Tour
            </a>
          </div>

          <div
            className={`mt-16 w-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-700 dark:border-gray-800 dark:bg-gray-900 ${
              isMounted ? "animate-fade-in" : "opacity-0 scale-[0.98]"
            }`}
          >
            <Image
              src="/supercheck-screenshot.png"
              alt="Supercheck dashboard preview"
              width={1600}
              height={1005}
              className="h-auto w-full rounded-lg object-cover"
              priority
            />
          </div>
        </section>

        <section className="bg-white/95 py-16 dark:bg-gray-950/95">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className={`flex h-full flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-all duration-700 dark:border-gray-800 dark:bg-gray-900 ${
                    isMounted ? "animate-fade-in" : "opacity-0 translate-y-4"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                    <Icon className="h-4 w-4" />
                    {title}
                  </div>
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 bg-gradient-to-t from-white/95 to-white/80 px-6 py-8 dark:bg-gradient-to-t dark:from-gray-950/95 dark:to-gray-950/80">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-6 text-sm dark:border-gray-800">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="https://www.youtube.com/@supercheck-io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <svg
                className="h-6 w-6"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
              >
                <path
                  fill="currentColor"
                  d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
                />
              </svg>
            </Link>
            <Link
              href="https://github.com/supercheck-io/supercheck"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <svg
                className="h-6 w-6"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
              >
                <path
                  fill="currentColor"
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                />
              </svg>
            </Link>
          </div>
          <span className="text-center text-gray-600 dark:text-gray-400">
            © {new Date().getFullYear()} Supercheck
          </span>
        </div>
      </footer>
    </div>
  );
}
