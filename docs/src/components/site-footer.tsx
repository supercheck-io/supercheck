import Link from "next/link";
import Image from "next/image";
import { DEMO_URL, GITHUB_URL, developersMenu, solutionsMenu } from "../lib/site-nav";

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
        title: "Product",
        links: [
            { name: "Automate", href: "/docs/app/automate" },
            { name: "Monitor", href: "/docs/app/monitor" },
            { name: "Respond", href: "/docs/app/investigate" },
            { name: "Communicate", href: "/docs/app/communicate" },
            { name: "Pricing", href: "/pricing" },
            { name: "Live demo", href: DEMO_URL },
        ],
    },
    {
        title: "Solutions",
        links: solutionsMenu.groups[0].items.map((item) => ({ name: item.title, href: item.href })),
    },
    {
        title: "Developers",
        links: [
            ...developersMenu.groups[0].items.map((item) => ({ name: item.title, href: item.href })),
            { name: "Chrome extension", href: "https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe" },
            { name: "Edge extension", href: "https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem" },
        ],
    },
    {
        title: "Community",
        links: [
            { name: "Discussions", href: `${GITHUB_URL}/discussions` },
            { name: "Issues", href: `${GITHUB_URL}/issues` },
            { name: "YouTube", href: "https://www.youtube.com/@supercheckhq" },
        ],
    },
];

const socialLinks = [
    {
        icon: <YoutubeIcon className="size-5" />,
        href: "https://www.youtube.com/@supercheckhq",
        label: "YouTube"
    },
    {
        icon: <Image src="/npm.svg" alt="npm" className="size-4.5" width={18} height={18} />,
        href: "https://www.npmjs.com/package/@supercheck/cli",
        label: "npm"
    },
];



export function SiteFooter({
    description = "Testing, monitoring, and AI SRE — as code.",
    copyright = `© ${new Date().getFullYear()} Supercheck. All rights reserved.`,
}: FooterProps) {
    return (
        <footer className="relative z-10 border-t border-fd-border bg-fd-background/95 py-12 md:py-16">
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
                                <h2 className="text-xl font-bold text-fd-foreground">Supercheck</h2>
                            </div>
                            <p className="text-sm text-fd-muted-foreground leading-relaxed mt-2">
                                {description}
                            </p>
                        </div>

                    </div>

                    <div className="grid w-full grid-cols-2 gap-8 md:grid-cols-4 lg:gap-12">
                        {sections.map((section, sectionIdx) => (
                            <div key={sectionIdx}>
                                <h3 className="mb-4 text-sm font-semibold text-fd-foreground">
                                    {section.title}
                                </h3>
                                <ul className="space-y-3 text-sm text-fd-muted-foreground">
                                    {section.links.map((link, linkIdx) => (
                                        <li key={linkIdx}>
                                            <Link
                                                href={link.href}
                                                className="hover:text-fd-foreground transition-colors"
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

                <div className="mt-12 flex flex-col justify-between gap-4 border-t border-fd-border pt-8 text-sm text-fd-muted-foreground md:flex-row md:items-center">
                    <p>{copyright}</p>
                    <ul className="flex items-center gap-6">
                        <li>
                            <Link href="/privacy" className="hover:text-fd-foreground transition-colors">
                                Privacy
                            </Link>
                        </li>
                        <li>
                            <Link href="/terms" className="hover:text-fd-foreground transition-colors">
                                Terms
                            </Link>
                        </li>
                        {socialLinks.map((social, idx) => (
                            <li key={idx}>
                                <a
                                    href={social.href}
                                    className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
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
