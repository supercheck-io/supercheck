import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../../../components/site-header";
import { SiteFooter } from "../../../components/site-footer";

export const metadata: Metadata = {
  title: { absolute: "SupercheckBot | Supercheck" },
  description: "SupercheckBot runs the Supercheck free tools. What it requests, how to recognise it and how to opt your site out.",
  alternates: { canonical: "/tools/bot" },
};

// An existing, monitored mailbox; the ops runbook covers replies.
const ABUSE = "hello@supercheck.io";

export default function BotPage() {
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-fd-background text-fd-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-24">
        <p className="text-sm font-medium text-monitor">
          <Link href="/tools" className="hover:underline">
            Free tools
          </Link>
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">SupercheckBot</h1>
        <div className="mt-8 space-y-6 text-pretty leading-relaxed text-fd-muted-foreground">
          <p>
            SupercheckBot makes the requests behind the{" "}
            <Link href="/tools" className="text-fd-primary hover:underline">
              Supercheck free tools
            </Link>
            . It runs only when a person types your address into a tool and passes a bot check. It never crawls and never follows links.
          </p>
          <h2 className="text-xl font-semibold text-fd-foreground">How to recognise it</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              User agent: <code className="font-mono text-sm">SupercheckBot/1.0 (+https://supercheck.io/tools/bot)</code>
            </li>
            <li>Requests come from Cloudflare Workers, so Cloudflare adds a <code className="font-mono text-sm">CF-Worker</code> header naming our workers.dev zone.</li>
            <li>Only GET and HEAD, on ports 80 and 443, with no cookies, body or credentials.</li>
          </ul>
          <h2 className="text-xl font-semibold text-fd-foreground">What it requests</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>One page and up to 5 redirects for the uptime and security headers tools.</li>
            <li>The home page, /llms.txt, /robots.txt and a few /.well-known/ files for the agent readiness tool.</li>
            <li>The page head and one HEAD request for its og:image for the social preview tool.</li>
            <li>The DNS lookup and domain expiry tools never contact your server.</li>
          </ul>
          <p>Each site gets at most about 10 checks a minute from each Cloudflare location, and results may be cached for 10 minutes.</p>
          <h2 className="text-xl font-semibold text-fd-foreground">Opt out</h2>
          <p>
            Email <a href={`mailto:${ABUSE}`} className="text-fd-primary hover:underline">{ABUSE}</a> with the subject &quot;SupercheckBot opt-out&quot; and your domain, and we add it to our block list, usually within a day. You can also block the user agent or the{" "}
            <code className="font-mono text-sm">CF-Worker</code> header at your firewall.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
