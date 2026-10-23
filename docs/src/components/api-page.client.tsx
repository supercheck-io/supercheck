'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';

export default createOpenAPIPage({
  playground: {
    fetchOptions: { requestTimeout: 30 },
  },
});
