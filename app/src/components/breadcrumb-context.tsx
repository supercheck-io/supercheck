'use client';

import React, { createContext, useContext, ReactNode, useState } from 'react';

export type BreadcrumbItem = {
  label: string;
  href?: string;
  isCurrentPage?: boolean;
};

type BreadcrumbContextType = {
  breadcrumbs: BreadcrumbItem[];
  setBreadcrumbs: (breadcrumbs: BreadcrumbItem[]) => void;
};

const BreadcrumbContext = createContext<BreadcrumbContextType | undefined>(undefined);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  const context = useContext(BreadcrumbContext);
  if (context === undefined) {
    throw new Error('useBreadcrumbs must be used within a BreadcrumbProvider');
  }
  return context;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const { setBreadcrumbs } = useBreadcrumbs();
  
  // Set breadcrumbs on component mount
  React.useEffect(() => {
    setBreadcrumbs(items);
    
    // Clean up on unmount
    return () => {
      setBreadcrumbs([]);
    };
  }, [items, setBreadcrumbs]);
  
  // This component doesn't render anything visible
  return null;
}
