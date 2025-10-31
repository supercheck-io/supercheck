import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import type { LinkItemType } from 'fumadocs-ui/layouts/docs';
import Image from 'next/image';
import { BookOpen, Github, ExternalLink } from 'lucide-react';

export const linkItems: LinkItemType[] = [
  {
    text: 'Home',
    url: '/',
    icon: <BookOpen />,
  },
  {
    type: 'icon',
    text: 'GitHub',
    url: 'https://github.com/supercheck-io/supercheck',
    icon: <Github />,
    external: true,
  },
  {
    type: 'icon',
    text: 'Demo',
    url: 'https://demo.supercheck.io/',
    icon: <ExternalLink />,
    external: true,
  },
];

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Image
            src="/supercheck-logo.png"
            alt="Supercheck Logo"
            width={24}
            height={24}
            className="rounded-md"
          />
          <span className="font-semibold max-md:hidden">Supercheck</span>
        </>
      ),
    },
    links: linkItems,
  };
}
