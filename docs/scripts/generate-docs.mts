import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// Sidebar order: list, then the other reads, then create, replace, update and delete; openapi.json order within each.
const rank = (method: string, operationId: string) =>
  method === 'get' ? (operationId.startsWith('list') ? 0 : 1) : ({ post: 2, put: 3, patch: 4, delete: 5 } as Record<string, number>)[method] ?? 6;
const found: Record<string, Array<{ id: string; rank: number }>> = {};
for (const item of Object.values(spec.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
    if (!operation.operationId) throw new Error(`${method.toUpperCase()} operation without an operationId in openapi.json`);
    const folder = folderOf(operation.tags);
    if (folder === 'billing') continue;
    if (!existsSync(`./content/docs/api/${folder}/${operation.operationId}.mdx`)) {
      throw new Error(`No generated page for ${folder}/${operation.operationId}`);
    }
    (found[folder] ??= []).push({ id: operation.operationId, rank: rank(method, operation.operationId) });
  }
}
// Array.prototype.sort is stable, so equal ranks keep their openapi.json order.
const pages = Object.fromEntries(Object.entries(found).map(([folder, list]) => [folder, list.sort((a, b) => a.rank - b.rank).map((entry) => entry.id)]));

// Delete pages and folders of operations that left the spec; the generator only ever adds.
for (const entry of readdirSync('./content/docs/api', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const folderPath = `./content/docs/api/${entry.name}`;
  if (!pages[entry.name]) {
    // Only folders this script owns (one per tag); a hand-written subfolder is left alone.
    if (entry.name in folderMeta || entry.name === 'billing') rmSync(folderPath, { recursive: true });
    continue;
  }
  for (const file of readdirSync(folderPath)) {
    if (file.endsWith('.mdx') && !pages[entry.name].includes(file.slice(0, -4))) rmSync(`${folderPath}/${file}`);
  }
}
const rootMetaPath = './content/docs/api/meta.json';
const rootPages = existsSync(rootMetaPath) ? (JSON.parse(readFileSync(rootMetaPath, 'utf8')) as { pages: string[] }).pages : null;
for (const [folder, operationIds] of Object.entries(pages)) {
  const meta = folderMeta[folder];
  if (!meta) throw new Error(`Add "${folder}" to folderMeta in generate-docs.mts`);
  if (rootPages && !rootPages.includes(folder)) throw new Error(`Add "${folder}" to content/docs/api/meta.json`);
  writeFileSync(`./content/docs/api/${folder}/meta.json`, `${JSON.stringify({ ...meta, pages: operationIds }, null, 2)}\n`);
}
