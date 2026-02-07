import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';

const openapi = createOpenAPI({
  input: ['./openapi.json'],
});

void generateFiles({
  input: openapi,
  output: './content/docs/api',
  includeDescription: true,
  groupBy: 'tag',
});
