import type { MetadataRoute } from "next";

// API routes answer 401 to unauthenticated clients, and the docs link to them, so
// crawlers report "Blocked due to unauthorised request". Keep them out of the crawl.
// Never disallow "/" here: customer status pages are served from *.supercheck.io
// subdomains by this same app and must stay indexable.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/api/" }],
  };
}
