import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';
import { syncOpenApi } from './sync-openapi.mjs';

syncOpenApi();

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

// Sidebar title (and icon or description) of each generated folder. A new tag must be added here, so its pages
// cannot ship without navigation.
const folderMeta: Record<string, { title: string; icon?: string; description?: string }> = {
  'ai-sre': { title: 'AI SRE', description: 'Incident response, investigations, Copilot, and service topology' },
  alerts: { title: 'Alerts API', icon: 'AlertTriangle' },
  audit: { title: 'Audit API', icon: 'ScrollText' },
  'cli-tokens': { title: 'CLI Tokens', icon: 'KeyRound' },
  jobs: { title: 'Jobs API', icon: 'CalendarClock' },
  monitors: { title: 'Monitors API', icon: 'Globe' },
  notifications: { title: 'Notifications API', icon: 'Bell' },
  organizations: { title: 'Organizations API', icon: 'Building2' },
  requirements: { title: 'Requirements API', icon: 'ListChecks' },
  runs: { title: 'Runs API', icon: 'ClipboardList' },
  'status-pages': { title: 'Status Pages', icon: 'Tally4' },
  system: { title: 'System API', icon: 'HeartPulse' },
  tags: { title: 'Tags API', icon: 'Tag' },
  tests: { title: 'Tests API', icon: 'FlaskConical' },
  'trigger-keys': { title: 'Trigger Keys', icon: 'Key' },
  variables: { title: 'Variables API', icon: 'Variable' },
};

const folderOf = (tags: unknown) => {
  const tag = Array.isArray(tags) && typeof tags[0] === 'string' ? tags[0] : 'other';
  return tagToFolder[tag] ?? slugify(tag);
};

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
  groupBy: (entry) => folderOf((entry as { item?: { tags?: string[] } }).item?.tags),
});

// Each folder's meta.json lists its pages in openapi.json order, so a regenerated page cannot be left out of
// the sidebar and a rerun writes identical files.
const spec = JSON.parse(readFileSync('./openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; tags?: string[] } | undefined>>;
};
const pages: Record<string, string[]> = {};
for (const item of Object.values(spec.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
    if (!operation.operationId) throw new Error(`${method.toUpperCase()} operation without an operationId in openapi.json`);
    const folder = folderOf(operation.tags);
    if (folder === 'billing') continue;
    if (!existsSync(`./content/docs/api/${folder}/${operation.operationId}.mdx`)) {
      throw new Error(`No generated page for ${folder}/${operation.operationId}`);
    }
    (pages[folder] ??= []).push(operation.operationId);
  }
}
const rootPages = (JSON.parse(readFileSync('./content/docs/api/meta.json', 'utf8')) as { pages: string[] }).pages;
for (const [folder, operationIds] of Object.entries(pages)) {
  const meta = folderMeta[folder];
  if (!meta) throw new Error(`Add "${folder}" to folderMeta in generate-docs.mts`);
  if (!rootPages.includes(folder)) throw new Error(`Add "${folder}" to content/docs/api/meta.json`);
  writeFileSync(`./content/docs/api/${folder}/meta.json`, `${JSON.stringify({ ...meta, pages: operationIds }, null, 2)}\n`);
}
