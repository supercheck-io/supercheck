'use client';
import { defineClientConfig } from 'fumadocs-openapi/ui/client';

export default defineClientConfig({
  playground: {
    requestTimeout: 30,
  },
});
