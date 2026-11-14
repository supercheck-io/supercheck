import type { ToolId } from "./tools-funnel";

export interface FreeTool {
  slug: string;
  id: ToolId;
  name: string;
  /** H1, matching the search query. */
  title: string;
  metaDescription: string;
  intro: string;
  /** Hub card blurb. */
  summary: string;
  input: "url" | "domain";
  placeholder: string;
  submitLabel: string;
  /** Says what one check from one place cannot tell you. */
  limits: string[];
  howWeCheck: string[];
  ctaTitle: string;
  ctaBody: string;
  faq: { question: string; answer: string }[];
}

const ONE_PLACE =
  "One check from one Cloudflare data center, usually the one nearest you. It can't tell you whether the site is down for everyone.";
const PRIVACY_FAQ = {
  question: "Do you store the URL I check?",
  answer:
    "Results sit in a 10-minute cache. Logs keep the host and the first path segment, never the full URL or query string, and never your IP address.",
};
const OPT_OUT_FAQ = {
  question: "Can I stop my site from being checked?",
  answer: "Yes. The SupercheckBot page explains how to ask for an opt-out; we add your domain to a block list.",
};

export const tools: FreeTool[] = [
  {
    slug: "website-uptime-checker",
    id: "uptime",
    name: "Website uptime checker",
    title: "Website uptime checker",
    metaDescription: "Check if a website is up right now: status code, response time and every redirect, from Cloudflare's edge. Free, no sign-up.",
    intro: "Is your site up right now? We load it once from Cloudflare's edge and show the status, response time and every redirect.",
    summary: "Is it up? Status, time and every redirect.",
    input: "url",
    placeholder: "https://your-site.com",
    submitLabel: "Check site",
    limits: [ONE_PLACE, "Response time is the total time to the first response, with no DNS, connect or TLS breakdown."],
    howWeCheck: [
      "We send one GET request as SupercheckBot and follow up to 5 redirects ourselves, checking each new host.",
      "A final status from 200 to 299 counts as up, the same default a Supercheck website monitor uses.",
      "Only ports 80 and 443 and public domain names can be checked.",
    ],
    ctaTitle: "One check tells you about now",
    ctaBody: "A Supercheck monitor checks as often as every minute and tells you the moment it changes.",
    faq: [
      { question: "Why does my site show up here but down for my users?", answer: ONE_PLACE },
      PRIVACY_FAQ,
      OPT_OUT_FAQ,
    ],
  },
  {
    slug: "api-endpoint-checker",
    id: "api",
    name: "API endpoint checker",
    title: "API endpoint checker",
    metaDescription: "Check a public API endpoint: status code, response time, content type, JSON validity and CORS. Free, no sign-up.",
    intro: "Check a public GET or HEAD endpoint: status code, response time, content type, and whether the JSON parses.",
    summary: "Status, JSON and CORS for GET or HEAD.",
    input: "url",
    placeholder: "https://api.your-site.com/health",
    submitLabel: "Check endpoint",
    limits: [ONE_PLACE, "Only GET and HEAD, without custom headers, a body or credentials.", "JSON is parsed on the first 64 KB only."],
    howWeCheck: [
      "We send one GET or HEAD request and follow up to 3 redirects.",
      "JSON counts as valid when the content type mentions json and the body parses.",
      "We show the Access-Control-Allow-Origin and Cache-Control headers as sent.",
    ],
    ctaTitle: "Need auth headers, assertions or POST requests?",
    ctaBody: "That's an API monitor in Supercheck: any method, headers from secrets, and checks on the response.",
    faq: [
      { question: "Why can't I send a POST or an API key?", answer: "A public tool that sends requests with bodies or credentials could be used against other people's APIs. Authenticated checks are what Supercheck monitors are for." },
      PRIVACY_FAQ,
      OPT_OUT_FAQ,
    ],
  },
  {
    slug: "https-checker",
    id: "https",
    name: "HTTPS checker",
    title: "HTTPS checker",
    metaDescription: "Check that HTTPS works, HTTP redirects to it, and how strong your HSTS header is, including preload status. Free, no sign-up.",
    intro: "Check that HTTPS works, that HTTP redirects to it, and how strong the HSTS header is.",
    summary: "Valid certificate, HTTP to HTTPS redirect, HSTS and preload.",
    input: "url",
    placeholder: "your-site.com",
    submitLabel: "Check HTTPS",
    limits: [
      "Expiry date and issuer are not visible from this check. A Supercheck website monitor with SSL checks tracks expiry.",
      "A certificate shows as valid when an HTTPS connection succeeds; we can't read the chain or TLS version.",
      ONE_PLACE,
    ],
    howWeCheck: [
      "We request https://your-domain/ and http://your-domain/, each with up to 3 redirects.",
      "HTTP passes when it ends on HTTPS on the same domain.",
      "We parse Strict-Transport-Security and ask hstspreload.org for the preload status.",
    ],
    ctaTitle: "This check can't see the expiry date",
    ctaBody: "A website monitor with SSL checks alerts you 30 days before the certificate expires.",
    faq: [
      { question: "Why don't you show the certificate expiry date?", answer: "The checker runs on Cloudflare Workers, which can't read the server's certificate. We say so rather than guess." },
      PRIVACY_FAQ,
      OPT_OUT_FAQ,
    ],
  },
  {
    slug: "security-headers-checker",
    id: "headers",
    name: "Security headers checker",
    title: "Security headers checker",
    metaDescription: "Grade the HTTP security headers of any page from A+ to F, with the rules printed so you can check the maths. Free, no sign-up.",
    intro: "Grade the HTTP security headers of any page from A+ to F. We fetch the URL once and the score comes back. The rules are printed below, so you can check our maths.",
    summary: "An A+ to F grade and a fix for each header.",
    input: "url",
    placeholder: "https://your-site.com",
    submitLabel: "Check headers",
    limits: ["Headers only. A good grade means the browser gets the right instructions, not that the app has no bugs.", ONE_PLACE],
    howWeCheck: [
      "Scoring follows Mozilla HTTP Observatory, limited to what one response can show. We start at 100.",
      "Bonuses count only when the score is already 90 or more. A missing header lowers the score; it never fails you on its own.",
      "We never keep Set-Cookie values, so cookies are not graded.",
    ],
    ctaTitle: "Headers change with every deploy",
    ctaBody: "A website monitor checks the page as often as every minute and alerts you when it stops responding.",
    faq: [
      { question: "Why don't you score cookies?", answer: "We don't keep Set-Cookie values from your site, so we can't grade them honestly." },
      { question: "Is this a security audit?", answer: "No. It covers headers only." },
      PRIVACY_FAQ,
      OPT_OUT_FAQ,
    ],
  },
  {
    slug: "agent-readiness-checker",
    id: "agents",
    name: "Agent readiness checker",
    title: "Is your site ready for AI agents?",
    metaDescription: "See how ChatGPT, Claude and other AI agents see your site: llms.txt, AI crawler rules, agent card, MCP discovery and bot blocks.",
    intro: "See how AI agents see your site: llms.txt, crawler rules, an agent card, and whether bot protection turns them away.",
    summary: "llms.txt, AI crawler rules, agent card and bot blocks.",
    input: "url",
    placeholder: "https://your-site.com",
    submitLabel: "Check site",
    limits: [
      "We read the first 128 KB of robots.txt and say when it was cut short.",
      "Blocking AI training crawlers is a valid choice, so we list them without judging.",
      ONE_PLACE,
    ],
    howWeCheck: [
      "HTTPS: the home page ends on an https URL.",
      "llms.txt: /llms.txt answers 200 and its first line is a Markdown heading (llmstxt.org).",
      "AI crawler rules: robots.txt does not disallow AI search and user agents (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User), matched by RFC 9309.",
      "Not blocked: the home page doesn't answer SupercheckBot with a bot challenge.",
      "Discovery, not counted: an A2A agent card at /.well-known/agent-card.json, and MCP discovery at /.well-known/ai-catalog.json or /.well-known/mcp/server-card.json. These paths are still settling.",
    ],
    ctaTitle: "Agents call your site when you're not looking",
    ctaBody: "Supercheck monitors your pages and APIs on a schedule, and its MCP server lets your coding agent read the results.",
    faq: [
      { question: "Is not publishing an agent card a failure?", answer: "No. Most sites don't run an agent. Discovery is shown as published or not published." },
      PRIVACY_FAQ,
      OPT_OUT_FAQ,
    ],
  },
  {
    slug: "dns-lookup",
    id: "dns",
    name: "DNS lookup",
    title: "DNS lookup",
    metaDescription: "Look up A, AAAA, CNAME, MX, TXT, NS and CAA records and DNSSEC validation for any domain. Free, no sign-up.",
    intro: "Look up A, AAAA, CNAME, MX, TXT, NS and CAA records, and whether DNSSEC validates.",
    summary: "A, AAAA, CNAME, MX, TXT, NS, CAA and DNSSEC.",
    input: "domain",
    placeholder: "your-site.com",
    submitLabel: "Look up",
    limits: ["Answers come from Cloudflare's resolver (1.1.1.1) and may be cached for up to the record's TTL.", "We show up to 50 records per type."],
    howWeCheck: [
      "We send seven DNS-over-HTTPS queries to Cloudflare's public resolver, one per record type.",
      "DNSSEC shows as validated when the resolver sets the authenticated data flag on the A query.",
    ],
    ctaTitle: "DNS changes break sites quietly",
    ctaBody: "A website monitor notices the moment your domain stops answering.",
    faq: [
      { question: "Why do I see a private IP address?", answer: "We show what your public DNS zone publishes. If it lists a private address, that is in the public record." },
      OPT_OUT_FAQ,
    ],
  },
  {
    slug: "social-preview-checker",
    id: "social",
    name: "Social preview checker",
    title: "Social preview checker",
    metaDescription: "See how a link looks when shared: title, description and image from Open Graph and X/Twitter tags, and whether the image loads.",
    intro: "See how a link looks when it's shared: title, description and image, from Open Graph and X/Twitter tags.",
    summary: "Open Graph and X/Twitter tags, and whether the image loads.",
    input: "url",
    placeholder: "https://your-site.com/blog/post",
    submitLabel: "Check preview",
    limits: [
      "We read the page's head, up to 64 KB. Each network renders cards a little differently.",
      "The image is not loaded until you click Show image, and then straight from its own server.",
    ],
    howWeCheck: [
      "We fetch the page once and read og:, twitter:, title and description tags from the head.",
      "We send a HEAD request to the og:image URL and check that it answers with an image content type.",
    ],
    ctaTitle: "Watch the page itself",
    ctaBody: "A website monitor checks it as often as every minute and alerts you when it breaks.",
    faq: [PRIVACY_FAQ, OPT_OUT_FAQ],
  },
  {
    slug: "domain-expiry-checker",
    id: "domain",
    name: "Domain expiry checker",
    title: "Domain expiry checker",
    metaDescription: "See when a domain's registration expires, from the registry's RDAP data. Free, no sign-up.",
    intro: "See when a domain's registration expires, from the registry's RDAP data. Some registries don't publish it; we say so instead of guessing.",
    summary: "Expiry date and registrar from RDAP, where the registry publishes it.",
    input: "domain",
    placeholder: "your-site.com",
    submitLabel: "Check domain",
    limits: [
      "Some registries (.io, .de, .co, .eu, .me and others) don't publish expiry dates through RDAP. For those we show not available; check your registrar's dashboard instead.",
      "We never scrape WHOIS or guess a date.",
    ],
    howWeCheck: [
      "We find the registry's RDAP server in IANA's bootstrap list and ask it for the domain.",
      "If the registry leaves out the expiry date, we follow at most one link to the registrar's RDAP server.",
    ],
    ctaTitle: "Monitor the site",
    ctaBody: "Then an expired domain never goes unnoticed.",
    faq: [
      { question: "Why does my domain show not available?", answer: "Its registry doesn't publish registration data over RDAP. We only show dates a registry publishes." },
      OPT_OUT_FAQ,
    ],
  },
];

export function getTool(slug: string): FreeTool | undefined {
  return tools.find((tool) => tool.slug === slug);
}
