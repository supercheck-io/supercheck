import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';

const openapi = createOpenAPI({
  input: ['./openapi.json'],
});

// Map tag names to folder names for consistent URL structure
const tagToFolder: Record<string, string> = {
  'Authentication': 'cli-tokens',
  'Trigger Keys': 'trigger-keys',
  'Status Pages': 'status-pages',
};

/**
 * Converts a tag name to a URL-safe kebab-case slug.
 * Strips non-alphanumeric characters (except hyphens/spaces), lowercases,
 * replaces spaces with hyphens, and collapses consecutive hyphens.
 */
function slugify(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/-{2,}/g, '-');
}

void generateFiles({
  input: openapi,
  output: './content/docs/api',
  includeDescription: true,
  groupBy: (entry) => {
    const item = (entry as { item?: { tags?: string[] } }).item
    const tags = Array.isArray(item?.tags) ? item?.tags : []
    const tag = tags[0] ?? 'other'
    return tagToFolder[tag] ?? slugify(tag);
  },
});
