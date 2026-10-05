'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export function DocsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/docs/app/welcome');
  }, [router]);

  return (
    <p className="p-6">
      Continue to the <Link href="/docs/app/welcome">Supercheck documentation</Link>.
    </p>
  );
}
