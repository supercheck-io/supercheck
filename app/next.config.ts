import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Content Security Policy configuration
 * Balanced approach: secure but not overly restrictive
 * Allows common CDNs, cloud storage, and third-party services
 */
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https: http://localhost:* http://127.0.0.1:*;
  style-src 'self' 'unsafe-inline' https: http://localhost:* http://127.0.0.1:*;
  img-src 'self' blob: data: https: http://localhost:* http://127.0.0.1:*;
  font-src 'self' data: https: http://localhost:* http://127.0.0.1:*;
  connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;
  media-src 'self' blob: data: https: http://localhost:* http://127.0.0.1:*;
  object-src 'none';
  frame-src 'self' https: http://localhost:* http://127.0.0.1:*;
  frame-ancestors 'self' https://*.supercheck.io https://supercheck.io http://localhost:* http://127.0.0.1:*;
  worker-src 'self' blob:;
  child-src 'self' blob:;
  base-uri 'self';
  form-action 'self' https:;
  manifest-src 'self';
  upgrade-insecure-requests;
`;

/**
 * Security headers configuration
 * Implements security best practices for production
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: ContentSecurityPolicy.replace(/\s{2,}/g, " ").trim(),
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
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
    // Turbopack is now the default bundler, turbopack config at root level
    turbopack: {
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
