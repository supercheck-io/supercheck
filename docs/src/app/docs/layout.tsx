import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import type { ReactNode } from 'react';

const tabConfig: Record<string, { description: string; color: string }> = {
  'Supercheck App': {
    description: 'Platform documentation',
    color: 'text-emerald-500',
  },
  'Supercheck CLI': {
    description: 'CLI for CI/CD automation',
    color: 'text-amber-500',
  },
  'Supercheck API': {
    description: 'REST API reference',
    color: 'text-sky-500',
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  const base = baseOptions();

  return (
    <DocsLayout
      tree={source.pageTree}
      {...base}
      nav={{
        ...base.nav,
        transparentMode: 'top',
      }}
      sidebar={{
        collapsible: true,
        defaultOpenLevel: 1,
        tabs: {
          transform(option, node) {
            const meta = source.getNodeMeta(node);
            if (!meta || !node.icon) return option;

            const title = typeof option.title === 'string' ? option.title : '';
            const config = tabConfig[title];

            return {
              ...option,
              description: config?.description ?? meta.data.description,
              icon: (
                <div
                  className={`[&_svg]:size-full size-full ${config?.color ?? ''}`}
                >
                  {node.icon}
                </div>
              ),
            };
          },
        },
      }}
    >
      {children}
    </DocsLayout>
  );
}
