import type { Metadata } from 'next';
import { source } from '../../../lib/source';
import { getMDXComponents } from '../../../mdx-components';
import { notFound } from 'next/navigation';
import { DocsRedirect } from '../../../components/docs-redirect';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import { GitHubIcon } from '../../../lib/layout.shared';
import Link from 'next/link';

export const revalidate = false;

function isDocsEntry(slug: string[] | undefined) {
  const path = slug?.join('/') ?? '';
  return path === '' || path === 'app' || path === 'app/quickstart';
}

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  if (isDocsEntry(params.slug)) {
    return <DocsRedirect />;
  }
  const page = source.getPage(params.slug);
  if (!page) notFound();

  // Fumadocs keeps the canonical source path, including folder index files.
  // URL slugs are not sufficient here because `app/deployment/index.mdx` and
  // `app/deployment.mdx` would both resolve to `/docs/app/deployment`.
  const filePath = page.path;

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
  const params = await source.generateParams();
  // Redirect-only routes (`/docs`, `/docs/app`, `/docs/app/quickstart`) have no
  // content page, but `output: 'export'` still needs their params to emit the
  // navigation fallback. If a real page is added at one of these slugs, remove the
  // matching entry here.
  return [
    { slug: [] },
    { slug: ['app'] },
    { slug: ['app', 'quickstart'] },
    ...params,
  ];
}

export async function generateMetadata(
  props: PageProps<'/docs/[[...slug]]'>,
): Promise<Metadata> {
  const params = await props.params;
  if (isDocsEntry(params.slug)) {
    return {
      title: 'Supercheck Documentation',
      description: 'Open Source AI-Powered Test Automation & Monitoring Platform',
    };
  }
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
