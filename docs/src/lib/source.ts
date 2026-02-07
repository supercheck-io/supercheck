import { docs } from '@/.source';
import { type InferPageType, loader } from 'fumadocs-core/source';
import { createElement, type ComponentType } from 'react';
import { openapiPlugin } from 'fumadocs-openapi/server';
import * as icons from 'lucide-react';

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  plugins: [openapiPlugin()],
  icon(icon) {
    if (!icon) return;
    if (icon in icons) {
      const IconComponent = icons[icon as keyof typeof icons] as ComponentType;
      return createElement(IconComponent);
    }
  },
});

export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  };
}

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
