"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useSearchParams } from "next/navigation";
import React, { useState, useEffect, Suspense } from "react";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";

// Function to generate breadcrumbs based on scriptType
const getBreadcrumbs = (scriptType: string | null) => {
  let testTypeLabel = "Test"; // Default label

  switch (scriptType) {
    case "browser":
      testTypeLabel = "Browser Test";
      break;
    case "api":
      testTypeLabel = "API Test";
      break;
    case "custom":
      testTypeLabel = "Custom Test";
      break;
    case "database":
      testTypeLabel = "Database Test";
      break;
    case "performance":
      testTypeLabel = "Performance Test";
      break;
  }

  return [
    { label: "Home", href: "/" },
    { label: "Tests", href: "/tests" },
    { label: `Create ${testTypeLabel}`, href: `/playground/?scriptType=${scriptType}` },
    { label: "Playground", isCurrentPage: true },
  ];
};

// Loading fallback component - maintains layout structure during loading
function LoadingFallback() {
  return (
    <div className="h-full flex flex-col">
      <PageBreadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Tests", href: "/tests" },
        { label: "Loading...", isCurrentPage: true },
      ]} />
      <div className="relative flex-1 overflow-hidden flex items-center justify-center">
        <SuperCheckLoading size="lg" message="Loading, please wait..." />
      </div>
    </div>
  );
}

// Client Boundary Component
function PlaygroundClientBoundary() {
  const searchParams = useSearchParams();
  const scriptType = searchParams.get("scriptType");
  const [isLoading, setIsLoading] = useState(true);

  const breadcrumbs = getBreadcrumbs(scriptType);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500); // Reduced timer for smoother UX

    return () => clearTimeout(timer);
  }, []);

  // Show loading state with spinner
  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        <PageBreadcrumbs items={breadcrumbs} />
        <div className="relative flex-1 overflow-hidden flex items-center justify-center">
          <SuperCheckLoading size="lg" message="Loading, please wait..." />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <div className="relative flex-1 overflow-hidden">
        <Playground />
      </div>
    </div>
  );
}

export default function PlaygroundPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PlaygroundClientBoundary />
    </Suspense>
  );
}
