import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Pre-render the search index at build time for static export
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
