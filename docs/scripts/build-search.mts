import { create, insert, save } from '@orama/orama';
import fs from 'node:fs/promises';
import path from 'node:path';

const contentDir = path.resolve(process.cwd(), 'docs/content/docs');
const publicDir = path.resolve(process.cwd(), 'docs/public');

async function getFiles(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = path.resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  }));
  return Array.prototype.concat(...files);
}

async function buildSearchIndex() {
  console.log('Building search index...');
  
  const db = await create({
    schema: {
      id: 'string',
      title: 'string',
      description: 'string',
      content: 'string',
      url: 'string',
    },
  });

  const files = await getFiles(contentDir);
  let count = 0;

  for (const file of files) {
    if (!file.endsWith('.mdx')) continue;

    const content = await fs.readFile(file, 'utf-8');
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    
    let title = '';
    let description = '';
    let body = content;

    if (match) {
      const frontmatter = match[1];
      body = content.replace(frontmatterRegex, '').trim();
      
      const titleMatch = frontmatter.match(/title:\s*(.*)/);
      if (titleMatch) title = titleMatch[1].trim().replace(/^['"]|['"]$/g, ''); // Remove quotes
      
      const descMatch = frontmatter.match(/description:\s*(.*)/);
      if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    // Generate URL from file path
    // Remove contentDir prefix and .mdx extension
    const relativePath = path.relative(contentDir, file);
    let url = '/docs/' + relativePath.replace(/\.mdx$/, '');
    
    // Handle index.mdx -> /
    if (url.endsWith('/index')) {
      url = url.substring(0, url.length - 6);
    }
    
    // Normalize URL
    if (url === '/docs') url = '/docs'; // Base URL
    else if (url === '') url = '/docs'; 

    // Ensure leading slash
    if (!url.startsWith('/')) url = '/' + url;

    await insert(db, {
      id: url,
      title,
      description,
      content: body,
      url,
    });
    count++;
  }

  const index = await save(db);
  
  // Ensure public dir exists
  try {
      await fs.access(publicDir);
  } catch {
      await fs.mkdir(publicDir, { recursive: true });
  }
  
  await fs.writeFile(path.join(publicDir, 'search-index.json'), JSON.stringify(index));
  console.log(`Search index generated at public/search-index.json with ${count} documents.`);
}

buildSearchIndex().catch((err) => {
    console.error(err);
    process.exit(1);
});
