import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';

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
          Supercheck Docs
        </>
      ),
    },
    links: [
      {
        text: 'Home',
        url: '/',
      },
      {
        text: 'GitHub',
        url: 'https://github.com/supercheck-io/supercheck',
        external: true,
      },
      {
        text: 'Demo',
        url: 'https://demo.supercheck.io/',
        external: true,
      },
    ],
  };
}
