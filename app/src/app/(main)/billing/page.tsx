"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Billing page - redirects to org-admin subscription tab
 * This page is deprecated in favor of the subscription tab in org-admin
 */
export default function BillingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/org-admin?tab=subscription');
  }, [router]);

  // Show skeleton while redirecting
  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
