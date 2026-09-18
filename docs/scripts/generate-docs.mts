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

await generateFiles({
  input: openapi,
  output: './content/docs/api',
  includeDescription: true,
  // Billing is a hosted-service concern, not part of the open-source API docs.
  // Filter it at generation time so a refresh cannot republish the pages.
  beforeWrite(files) {
    for (let index = files.length - 1; index >= 0; index -= 1) {
      if (/^billing[\\/]/.test(files[index]?.path ?? '')) files.splice(index, 1);
    }
  },
  groupBy: (entry) => {
    const item = (entry as { item?: { tags?: string[] } }).item
    const tags = Array.isArray(item?.tags) ? item?.tags : []
    const tag = tags[0] ?? 'other'
    return tagToFolder[tag] ?? slugify(tag);
  },
});
