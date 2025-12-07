import { createMDX } from 'fumadocs-mdx/next';
import { resolve } from 'path';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
};

export default withMDX(config);
