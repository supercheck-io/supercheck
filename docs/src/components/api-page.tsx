import { openapi } from '../lib/openapi';
import type { OpenAPIPageProps_Spec } from 'fumadocs-openapi/ui';
import OpenAPIPage from './api-page.client';

export async function APIPage({
  document,
  ...props
}: Omit<OpenAPIPageProps_Spec, 'payload'> & { document: string }) {
  const { bundled } = await openapi.getSchema(document);
  return (
    <OpenAPIPage
      {...props}
      document={document}
      payload={{ bundled, proxyUrl: openapi.options.proxyUrl }}
    />
  );
}
