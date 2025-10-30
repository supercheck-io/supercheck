import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Content Security Policy configuration
 * Helps prevent XSS attacks and other code injection attacks
 */
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' blob: data: https:;
  font-src 'self' data: https://fonts.gstatic.com;
  connect-src 'self' https://*.amazonaws.com https://api.openai.com;
  media-src 'self' https://*.amazonaws.com;
  frame-src 'self' https://challenges.cloudflare.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
`;

/**
 * Security headers configuration
 * Implements security best practices for production
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy.replace(/\s{2,}/g, ' ').trim(),
  },
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

const createNextConfig = (phase: string): NextConfig => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  const baseConfig: NextConfig = {
    /* config options here */
    output: "standalone",
    serverExternalPackages: ["child_process", "fs", "path", "postgres"],
    images: {
      remotePatterns: [
        {
          protocol: "https",
          hostname: "**",
        },
      ],
      unoptimized: true,
    },
    experimental: {
      // Add any experimental features here
    },
    // Security headers (only in production)
    ...(isDev ? {} : {
      headers: async () => [
        {
          source: '/:path*',
          headers: securityHeaders,
        },
      ],
    }),
    // Turbopack configuration (stable in Next.js 15+)
    ...(isDev && {
      turbopack: {
        rules: {
          // Add any Turbopack-specific rules here if needed
        },
      },
    }),
    // Configure server options
    serverRuntimeConfig: {
      // Will only be available on the server side
      ignoreSSLErrors: true,
    },
    // Configure environment variables for both client and server
    publicRuntimeConfig: {
      // Will be available on both server and client
      apiTimeout: 60000, // 60 seconds
    },
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
