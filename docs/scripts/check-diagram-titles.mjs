import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const diagramRoot = join(docsRoot, 'public', 'diagrams');
const sourceRoot = join(docsRoot, 'diagrams');
const errors = [];
const words = (value) => value.trim().split(/\s+/u).filter(Boolean).length;

for (const filename of readdirSync(diagramRoot).filter((name) =>
  name.endsWith('.html') && !name.endsWith('.visual-check.html'))) {
  const htmlPath = join(diagramRoot, filename);
  const sourcePath = join(sourceRoot, filename.replace(/\.html$/u, '.json'));
  if (!existsSync(sourcePath)) {
    errors.push(`${filename}: missing editable diagram source`);
    continue;
  }

  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const content = readFileSync(htmlPath, 'utf8');
  const documentTitle = content.match(/<head>[\s\S]*?<title>([^<]+)<\/title>/u);
  if (!documentTitle) {
    errors.push(`${filename}: missing document title`);
    continue;
  }

  const labels = [
    ['document title', content.match(/<head>[\s\S]*?<title>([^<]+)<\/title>/u)?.[1]],
    ['page heading', content.match(/<h1>([^<]+)<\/h1>/u)?.[1]],
    ['diagram title', content.match(/<title id="archify-diagram-title">([^<]+)<\/title>/u)?.[1]],
    ...Array.from(content.matchAll(/<h3>([^<]+)<\/h3>/gu), (match) => ['card heading', match[1]]),
    ['source title', source.meta.title],
    ...source.cards?.map((card) => ['source card', card.title]) ?? [],
    ...source.meta.views?.map((view) => ['source view', view.label]) ?? [],
  ];
  for (const [kind, label] of labels) {
    // Archify appends "Diagram" to the browser title, not the visible heading.
    const title = kind === 'document title' && label === `${source.meta.title} Diagram`
      ? source.meta.title : label;
    if (!title || words(title) > 2) errors.push(`${filename}: ${kind} must have one or two words: ${label ?? '(missing)'}`);
  }
}

function checkEmbeds(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      checkEmbeds(path);
      continue;
    }
    if (!entry.name.endsWith('.mdx')) continue;
    const content = readFileSync(path, 'utf8');
    for (const match of content.matchAll(/<DiagramEmbed\s+src="([^"]+)"\s+title="([^"]+)"/gu)) {
      const [, src, title] = match;
      if (words(title) > 2) errors.push(`${path}: embed title exceeds two words: ${title}`);
      if (!src.startsWith('/diagrams/') || !existsSync(join(docsRoot, 'public', src.slice(1)))) {
        errors.push(`${path}: missing diagram asset: ${src}`);
      }
      const before = content.slice(0, match.index);
      const heading = [...before.matchAll(/^#{1,6}\s+(.+)$/gmu)].at(-1)?.[1]
        ?? content.match(/^title:\s*(.+)$/mu)?.[1];
      if (!heading || words(heading) > 2) errors.push(`${path}: diagram needs a heading of at most two words`);
    }
  }
}

checkEmbeds(join(docsRoot, 'content', 'docs', 'app'));
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log('Diagram titles, headings, sources, and embeds are valid.');
}
