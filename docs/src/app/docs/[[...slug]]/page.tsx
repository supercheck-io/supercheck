import type { Metadata } from 'next';
import { source, getPageImage } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';
import { notFound } from 'next/navigation';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import {
  DocsBody,
  DocsPage,
} from 'fumadocs-ui/page';
import { Edit } from 'lucide-react';
import Link from 'next/link';

export const revalidate = false;

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const path = params.slug?.join('/') || 'index';

  return (
    <DocsPage
      toc={page.data.toc}
      tableOfContent={{
        style: 'clerk',
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-2">
        <h1 className="text-[1.75em] font-semibold">{page.data.title}</h1>
        <Link
          href={`https://github.com/supercheck-io/supercheck/blob/main/docs/content/docs/${path}.mdx`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors border rounded-md px-2.5 py-1 shrink-0 mt-1"
        >
          <Edit className="size-3.5" />
          Edit on GitHub
        </Link>
      </div>
      <p className="text-lg text-fd-muted-foreground border-b pb-6 mb-6">
        {page.data.description}
      </p>
      <DocsBody className="prose flex-1 text-fd-foreground/90">
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
