'use client';

import React from 'react';
import { Breadcrumbs, BreadcrumbItem } from '@/components/breadcrumb-context';

interface PageBreadcrumbsProps {
  items: BreadcrumbItem[];
}

/**
 * Component to set breadcrumbs for a page.
 * This component should be used at the page level to define breadcrumbs.
 * It doesn't render anything visible but sets the breadcrumbs in the context.
 */
export function PageBreadcrumbs({ items }: PageBreadcrumbsProps) {
  return <Breadcrumbs items={items} />;
}
