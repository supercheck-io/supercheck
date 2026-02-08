import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
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
