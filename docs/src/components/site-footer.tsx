import Link from "next/link";
import Image from "next/image";

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

function DiscordIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
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
            { name: "Chrome Extension", href: "https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe" },
            { name: "YouTube", href: "https://www.youtube.com/@supercheck-io" },
            { name: "GitHub", href: "https://github.com/supercheck-io/supercheck" },
        ],
    },
    {
        title: "Community",
        links: [
            { name: "Discord", href: "https://discord.gg/UVe327CSbm" },
            { name: "Discussions", href: "https://github.com/supercheck-io/supercheck/discussions" },
            { name: "Issues", href: "https://github.com/supercheck-io/supercheck/issues" },
        ],
    },
];

const socialLinks = [
    {
        icon: <DiscordIcon className="size-5" />,
        href: "https://discord.gg/UVe327CSbm",
        label: "Discord"
    },
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
                        {/* Logo and description */}
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Image
                                    src="/supercheck-logo.png"
                                    alt="Supercheck Logo"
                                    width={28}
                                    height={28}
                                    className="rounded"
                                />
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Supercheck</h2>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mt-2">
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
