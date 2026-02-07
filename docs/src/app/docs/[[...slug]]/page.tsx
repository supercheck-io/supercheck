import type { Metadata } from 'next';
import { source, getPageImage } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';
import { notFound } from 'next/navigation';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import { GitHubIcon } from '@/lib/layout.shared';
import Link from 'next/link';

export const revalidate = false;

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  // Get the file path from slugs - the path corresponds to the slug structure with .mdx extension
  // For index pages (like deployment/index.mdx), slugs is ['deployment'], so we append index.mdx
  // For standalone pages (like monitors.mdx), slugs is ['monitors'], so we append .mdx
  const filePath = page.slugs.length === 0
    ? 'index.mdx'
    : `${page.slugs.join('/')}.mdx`;

  const MDX = page.data.body;
  const isFullWidth = page.data.full === true;

  if (isFullWidth) {
    return (
      <DocsPage full>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX
            components={getMDXComponents({
              a: createRelativeLink(source, page),
            })}
          />
        </DocsBody>
      </DocsPage>
    );
  }

  return (
    <DocsPage
      toc={page.data.toc}
      tableOfContent={{
        style: 'clerk',
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="flex items-center justify-between gap-4">
        <span>{page.data.description}</span>
        <Link
          href={`https://github.com/supercheck-io/supercheck/blob/main/docs/content/docs/${filePath}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors border rounded-md px-3 py-1.5 shrink-0 hover:bg-fd-accent"
        >
          <GitHubIcon />
          Edit
        </Link>
      </DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<'/docs/[[...slug]]'>,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImage(page).url,
    },
  };
}
