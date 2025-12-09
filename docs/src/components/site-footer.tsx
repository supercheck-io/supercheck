import Link from "next/link";

function GithubIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
    );
}

function YoutubeIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
    );
}

interface FooterProps {
    description?: string;
    copyright?: string;
}

const sections = [
    {
        title: "Docs",
        links: [
            { name: "Quick Start", href: "/docs/quickstart" },
            { name: "Self-Hosted Setup", href: "/docs/deployment/self-hosted" },
            { name: "Tests", href: "/docs/automate/tests" },
            { name: "Monitors", href: "/docs/monitors" },
        ],
    },
    {
        title: "Resources",
        links: [
            { name: "Live Demo", href: "https://demo.supercheck.io" },
            { name: "YouTube", href: "https://www.youtube.com/@supercheck-io" },
            { name: "GitHub", href: "https://github.com/supercheck-io/supercheck" },
        ],
    },
    {
        title: "Community",
        links: [
            { name: "Discussions", href: "https://github.com/supercheck-io/supercheck/discussions" },
            { name: "Issues", href: "https://github.com/supercheck-io/supercheck/issues" },
        ],
    },
];

const socialLinks = [
    {
        icon: <YoutubeIcon className="size-5" />,
        href: "https://www.youtube.com/@supercheck-io",
        label: "YouTube"
    },
    {
        icon: <GithubIcon className="size-5" />,
        href: "https://github.com/supercheck-io/supercheck",
        label: "GitHub"
    },
];



export function SiteFooter({
    description = "Open source AI-powered test automation & monitoring platform.",
    copyright = `© ${new Date().getFullYear()} Supercheck. All rights reserved.`,
}: FooterProps) {
    return (
        <footer className="relative z-10 border-t border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 py-12 md:py-16">
            <div className="mx-auto max-w-6xl px-6">
                <div className="flex w-full flex-col justify-between gap-10 lg:flex-row lg:items-start lg:text-left">
                    <div className="flex w-full flex-col justify-between gap-6 lg:max-w-xs lg:items-start">
                        {/* Description only (Logo removed as requested) */}
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Supercheck</h2>
                            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                                {description}
                            </p>
                        </div>

                    </div>

                    <div className="grid w-full grid-cols-2 gap-8 md:grid-cols-3 lg:gap-12">
                        {sections.map((section, sectionIdx) => (
                            <div key={sectionIdx}>
                                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-900 dark:text-white">
                                    {section.title}
                                </h3>
                                <ul className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                                    {section.links.map((link, linkIdx) => (
                                        <li key={linkIdx}>
                                            <Link
                                                href={link.href}
                                                className="hover:text-gray-900 dark:hover:text-white transition-colors"
                                                target={link.href.startsWith("http") ? "_blank" : undefined}
                                                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                                            >
                                                {link.name}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-12 flex flex-col justify-between gap-4 border-t border-gray-200 dark:border-gray-800 pt-8 text-sm text-gray-500 dark:text-gray-400 md:flex-row md:items-center">
                    <p>{copyright}</p>
                    <ul className="flex items-center gap-6">
                        {socialLinks.map((social, idx) => (
                            <li key={idx}>
                                <a
                                    href={social.href}
                                    className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={social.label}
                                >
                                    {social.icon}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </footer>
    );
}
