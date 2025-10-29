"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import Image from "next/image";
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
  Moon,
  Sun,
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

const featureVariants = {
  container: {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  },
  item: {
    hidden: {
      opacity: 0,
      y: 20,
      scale: 0.95,
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        type: "spring" as const,
        bounce: 0.1,
        duration: 0.6,
      },
    },
  },
};

function StarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

const transitionVariants = {
  item: {
    hidden: {
      opacity: 0,
      filter: "blur(4px)",
      y: 8,
    },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      y: 0,
      transition: {
        type: "spring" as const,
        bounce: 0.15,
        duration: 0.8,
      },
    },
  },
};

export default function HomePage() {
  const [isDark, setIsDark] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

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
          <Link href="/" className="flex items-center space-x-3">
            <Image
              src="/supercheck-logo.png"
              alt="Supercheck"
              width={40}
              height={40}
              className="rounded-lg"
            />
            <span className="font-bold text-gray-900 dark:text-white text-lg">
              Supercheck
            </span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/docs"
              className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition"
            >
              Docs
            </Link>
            {isMounted && (
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-300"
                aria-label="Toggle theme"
              >
                <motion.div
                  initial={{ rotate: 0 }}
                  animate={{ rotate: isDark ? 180 : 0 }}
                  transition={{ duration: 0.5 }}
                >
                  {isDark ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )}
                </motion.div>
              </button>
            )}
            <a
              href="https://github.com/supercheck-io/supercheck"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition"
            >
              <svg
                className="h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      <main className="relative overflow-hidden">
        <section className="relative z-10">
          <div className="relative pt-28 pb-12">
            <div className="mx-auto max-w-6xl px-6 relative z-20">
              <div className="text-center mx-auto max-w-4xl">
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={transitionVariants}
                  className="mx-auto"
                >
                  <Link
                    href="https://demo.supercheck.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group mx-auto flex w-fit items-center gap-4 rounded-full border border-white/20 dark:border-white/20 bg-white/10 dark:bg-white/10 px-4 py-2 shadow-md shadow-zinc-950/5 transition-colors duration-300 dark:shadow-zinc-950 backdrop-blur-sm"
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
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, filter: "blur(4px)", y: 8 }}
                  animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                  transition={{
                    type: "spring",
                    bounce: 0.15,
                    duration: 0.8,
                    delay: 0.2,
                  }}
                  className="mt-16 text-balance text-4xl font-bold leading-tight text-gray-900 dark:text-white md:text-5xl lg:text-6xl"
                >
                  AI-Powered Automation & Monitoring for Modern Apps
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, filter: "blur(4px)", y: 8 }}
                  animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                  transition={{
                    type: "spring",
                    bounce: 0.15,
                    duration: 0.8,
                    delay: 0.4,
                  }}
                  className="mx-auto mt-8 max-w-3xl text-balance text-xl leading-relaxed text-gray-600 dark:text-gray-300"
                >
                  Empowering development and SRE teams with a scalable,
                  distributed, and robust platform to drive faster delivery and
                  higher software quality.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, filter: "blur(4px)", y: 8 }}
                  animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                  transition={{
                    type: "spring",
                    bounce: 0.15,
                    duration: 0.8,
                    delay: 0.6,
                  }}
                  className="mt-12 flex flex-row items-center justify-center gap-2 flex-wrap"
                >
                  <a
                    href="https://github.com/supercheck-io/supercheck"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 text-white dark:text-gray-900 font-medium text-base rounded-lg border border-gray-800 dark:border-gray-300 transition-all duration-200 shadow-sm hover:shadow-md px-2 py-3 min-w-[160px] h-[38px] mr-5"
                  >
                    <StarIcon className="size-4" />
                    <span>Star on GitHub</span>
                  </a>
                  <a
                    href="https://www.youtube.com/watch?v=eQ_aCghTpeI&list=PLw76CEQ8n7V6__OFWqtsvsgX1anVmuRk0"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium text-base rounded-lg border border-red-600 transition-all duration-200 shadow-sm hover:shadow-md px-2 py-3 min-w-[160px] h-[38px]"
                  >
                    <svg
                      className="h-4 w-4"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                    <span>Watch Tutorial</span>
                  </a>
                </motion.div>
              </div>

              {/* Supercheck App Preview - Full Width */}
              <motion.div
                initial={{
                  opacity: 0,
                  filter: "blur(3px)",
                  y: 12,
                  scale: 0.98,
                }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0, scale: 1 }}
                transition={{
                  type: "spring",
                  bounce: 0.1,
                  duration: 0.9,
                  delay: 1,
                }}
                className="mt-16 mx-auto max-w-7xl px-8"
              >
                <Image
                  src="/supercheck-screenshot.png"
                  alt="Supercheck App - Automation & Monitoring Dashboard"
                  width={1600}
                  height={1005}
                  className="w-full h-auto object-contain rounded-lg border border-gray-200 dark:border-gray-800 shadow-2xl"
                  priority
                />
              </motion.div>
            </div>
          </div>
        </section>

        <section className="py-2">
          <div className="mx-auto max-w-6xl space-y-6 px-6">
            <motion.div
              variants={featureVariants.container}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="relative mx-auto grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
            >
              {features.map(({ icon: Icon, title, description }) => (
                <motion.div
                  key={title}
                  variants={featureVariants.item}
                  className="rounded-lg border border-gray-200/30 dark:border-gray-800/30 bg-white/95 dark:bg-gray-950/95 p-6 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="size-4" />
                    <h3 className="text-sm font-medium">{title}</h3>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">
                    {description}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-6">
            <Link href="/" className="flex items-center space-x-2">
              <Image
                src="/supercheck-logo.png"
                alt="Supercheck"
                width={28}
                height={28}
                className="rounded-lg"
              />
              <span className="font-semibold text-gray-900 dark:text-white">
                Supercheck
              </span>
            </Link>
            <a
              href="https://www.youtube.com/@supercheck-io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <svg
                className="h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            </a>
            <a
              href="https://github.com/supercheck-io/supercheck"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <svg
                className="h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </div>
          <span className="text-center text-gray-600 dark:text-gray-400">
            © {new Date().getFullYear()} Supercheck
          </span>
        </div>
      </footer>
    </div>
  );
}
