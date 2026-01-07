import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import path from "path";

/**
 * Content Security Policy configuration
 * Self-hosting friendly: uses existing APP_URL/TRUSTED_ORIGINS for domain configuration
 * 
 * Uses existing environment variables:
 * - APP_URL: Primary application URL (used for frame-ancestors)
 * - TRUSTED_ORIGINS: Additional trusted domains (comma-separated)
 * - SELF_HOSTED: When true, skips HSTS to support HTTP deployments
 */
function buildFrameAncestors(): string {
  const origins: string[] = ["'self'"];
  
  // Add APP_URL domain if set
  if (process.env.APP_URL) {
    try {
      const url = new URL(process.env.APP_URL);
      origins.push(url.origin);
    } catch {
      // Invalid URL, skip
    }
  }
  
  // Add TRUSTED_ORIGINS if set
  if (process.env.TRUSTED_ORIGINS) {
    const trusted = process.env.TRUSTED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean);
    origins.push(...trusted);
  }
  
  return origins.join(" ");
}

const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https: http:;
  style-src 'self' 'unsafe-inline' https: http:;
  img-src 'self' blob: data: https: http:;
  font-src 'self' data: https: http:;
  connect-src 'self' https: wss: http: ws:;
  media-src 'self' blob: data: https: http:;
  object-src 'none';
  frame-src 'self' https: http:;
  frame-ancestors ${buildFrameAncestors()};
  worker-src 'self' blob:;
  child-src 'self' blob:;
  base-uri 'self';
  form-action 'self' https: http:;
  manifest-src 'self';
`;

/**
 * Security headers configuration
 * - HSTS enabled only for non-self-hosted (cloud) deployments with HTTPS
 * - Self-hosted deployments may use HTTP internally
 */
const isHttps = process.env.APP_URL?.startsWith("https://");
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: ContentSecurityPolicy.replace(/\s{2,}/g, " ").trim(),
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  // HSTS only for HTTPS deployments that aren't self-hosted (or self-hosted with HTTPS)
  ...(isHttps
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const createNextConfig = (phase: string): NextConfig => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  const baseConfig: NextConfig = {
    /* config options here */
    output: "standalone",
    // Server Actions configuration - increase body size limit for document uploads
    // Default is 1MB, we need to support up to MAX_DOCUMENT_SIZE_MB (10MB default)
    experimental: {
      serverActions: {
        bodySizeLimit: "12mb", // Slightly higher than MAX_DOCUMENT_SIZE_MB to account for encoding overhead
      },
    },
    serverExternalPackages: [
      "child_process",
      "fs",
      "path",
      "postgres",
      "bullmq",
      "@bull-board/api",
      "@bull-board/express",
      // Pino and its dependencies need to be external for Turbopack compatibility
      "pino",
      "pino-pretty",
      "pino-http",
      "thread-stream",
      // PDF processing libraries need to be external for server-side usage
      "unpdf",
      "@napi-rs/canvas",
      "canvas",
      // Document processing
      "mammoth",
    ],
    images: {
      remotePatterns: [
        {
          protocol: "https",
          hostname: "**",
        },
      ],
      unoptimized: true,
    },
    // Security headers (only in production)
    ...(isDev
      ? {}
      : {
          headers: async () => [
            {
              source: "/:path*",
              headers: securityHeaders,
            },
          ],
        }),
    // Turbopack configuration (default in Next.js 16+)
    // Turbopack is now the default bundler
    turbopack: {
      root: path.resolve(__dirname, ".."),
      rules: {
        // Add any Turbopack-specific rules here if needed
      },
      // Note: resolveAlias not needed - polarClient removed from auth-client.ts
      // to avoid node:async_hooks import issues in the browser
    },
    // Note: serverRuntimeConfig and publicRuntimeConfig are deprecated in Next.js 16
    // Use environment variables directly instead
  };

  // Only apply Webpack customizations in production (when not using Turbopack)
  if (!isDev) {
    baseConfig.webpack = (config, { isServer }) => {
      config.ignoreWarnings = [
        {
          module: /node_modules\/bullmq/,
          message:
            /Critical dependency: the request of a dependency is an expression/,
        },
        {
          module: /node_modules\/bullmq/,
          message: /the request of a dependency is an expression/,
        },
        {
          module: /node_modules\/kysely/,
          message:
            /Critical dependency: the request of a dependency is an expression/,
        },
      ];

      // Server-side only modules - no polyfills needed for client
      if (!isServer) {
        config.resolve.fallback = {
          ...config.resolve.fallback,
          crypto: false,
          buffer: false,
          stream: false,
        };
      }

      return config;
    };
  }

  return baseConfig;
};

export default createNextConfig;
