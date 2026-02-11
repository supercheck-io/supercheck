import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const __dirname = dirname(fileURLToPath(import.meta.url));

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Ensure module resolution stays within the docs package in this monorepo.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Tree-shake barrel re-exports from these packages
    optimizePackageImports: [
      'lucide-react',
      'fumadocs-ui',
      'fumadocs-core',
    ],
  },
};

export default withMDX(config);
