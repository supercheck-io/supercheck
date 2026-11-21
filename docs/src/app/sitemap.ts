import type { MetadataRoute } from "next";
import { source } from "../lib/source";
import { products } from "../lib/products";
import { solutions } from "../lib/solutions";
import { tools } from "../lib/tools";

export const dynamic = "force-static";

const SITE = "https://supercheck.io";
// These docs paths only redirect to the welcome page.
const REDIRECT_ONLY = new Set(["/docs", "/docs/app", "/docs/app/quickstart"]);

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    "",
    "/pricing",
    ...products.map((p) => `/product/${p.slug}`),
    ...solutions.map((s) => `/solutions/${s.slug}`),
    "/tools",
    ...tools.map((t) => `/tools/${t.slug}`),
    "/tools/bot",
    "/security",
    "/privacy",
    "/terms",
    ...source.getPages().map((page) => page.url).filter((url) => !REDIRECT_ONLY.has(url)),
  ];
  return pages.map((path) => ({ url: `${SITE}${path}` }));
}
