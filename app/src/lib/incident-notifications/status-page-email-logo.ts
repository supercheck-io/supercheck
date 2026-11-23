import { emailAppUrl } from "@/emails/base-layout";
import { generateProxyUrl } from "@/lib/asset-proxy";

/**
 * Absolute URL of a status page's email logo, or undefined when it has none or no usable URL.
 * Stored logos are served by /api/assets, which is public for published pages (the only ones that email subscribers).
 */
export function statusPageEmailLogoUrl(transactionalLogo: string | null | undefined): string | undefined {
  const url = generateProxyUrl(transactionalLogo);
  if (!url) return undefined;
  const absolute = url.startsWith("/") ? `${emailAppUrl()}${url}` : url;
  return /^https?:\/\//.test(absolute) ? absolute : undefined;
}
