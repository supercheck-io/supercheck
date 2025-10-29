"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useSearchParams } from "next/navigation";
import React, { useState, useEffect, Suspense } from "react";
import { cn } from "@/lib/utils";
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
    // Add more cases if needed
  }

  return [
    { label: "Home", href: "/" },
    { label: "Tests", href: "/tests" },
    { label: `Create ${testTypeLabel}`, href: `/playground/?scriptType=${scriptType}` },
    { label: "Playground", isCurrentPage: true },
  ];
};

// Client Boundary Component
function PlaygroundClientBoundary() {
  const searchParams = useSearchParams();
  const scriptType = searchParams.get("scriptType");
  const [isLoading, setIsLoading] = useState(true);

  const breadcrumbs = getBreadcrumbs(scriptType);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1500); // Keep the loading timer

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <div className="relative flex-1 overflow-hidden">
        {/* Show skeleton only if isLoading is true */}
        {isLoading && <PlaygroundSkeleton />}
        {/* Actual Playground content with transition */}
        <div
          className={cn(
            "transition-opacity duration-300 h-full",
            isLoading ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
        >
          {/* Suspense around Playground might still be needed if Playground uses client hooks */}
          <Suspense fallback={<div>Loading Playground Component...</div>}>
            <Playground />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default function PlaygroundPage() {
  // No useSearchParams or client logic here
  return (
    <Suspense fallback={<PlaygroundSkeleton />}>
      <PlaygroundClientBoundary />
    </Suspense>
  );
}
