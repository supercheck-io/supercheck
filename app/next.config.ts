import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

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
