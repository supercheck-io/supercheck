"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useSearchParams } from "next/navigation";
import React, { Suspense } from "react";
import { PlaygroundSkeleton } from "@/components/playground/playground-skeleton";

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

// Loading fallback component - shows skeleton during initial load
function LoadingFallback() {
  return <PlaygroundSkeleton />;
}

// Client Boundary Component
function PlaygroundClientBoundary() {
  const searchParams = useSearchParams();
  const scriptType = searchParams.get("scriptType");
  const breadcrumbs = getBreadcrumbs(scriptType);

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
