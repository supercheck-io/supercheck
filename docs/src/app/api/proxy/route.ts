import { openapi } from '@/lib/openapi';

const proxy = openapi.createProxy({
  allowedOrigins: [
    'https://demo.supercheck.dev',
    'https://app.supercheck.io',
  ],
});

export const GET = proxy.GET;
export const POST = proxy.POST;
export const PUT = proxy.PUT;
export const PATCH = proxy.PATCH;
export const DELETE = proxy.DELETE;
export const HEAD = proxy.HEAD;
