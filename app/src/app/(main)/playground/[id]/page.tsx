"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import React, { useMemo, useEffect, Suspense } from "react";
import { useParams, notFound } from "next/navigation";
import { useTest } from "@/hooks/use-tests";
import { PlaygroundSkeleton } from "@/components/playground/playground-skeleton";

// Loading fallback component - shows skeleton during initial load
function LoadingFallback() {
  return <PlaygroundSkeleton />;
}

// Valid test types for type checking
const VALID_TEST_TYPES = ["browser", "api", "custom", "database", "performance"] as const;
type ValidTestType = (typeof VALID_TEST_TYPES)[number];

function isValidTestType(type: unknown): type is ValidTestType {
  return typeof type === "string" && (VALID_TEST_TYPES as readonly string[]).includes(type);
}

// Client Boundary Component - handles test loading with React Query
function PlaygroundIdClientBoundary() {
  const params = useParams();
  const id = params.id as string;

  // Use React Query hook for test data - loading state handled by React Query
  const { data: testData, isLoading: isQueryLoading, error } = useTest(id);

  // Redirect to not-found if test doesn't exist (only after loading completes)
  useEffect(() => {
    if (!isQueryLoading && (error || !testData)) {
      notFound();
    }
  }, [error, isQueryLoading, testData]);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Tests", href: "/tests" },
    { label: testData?.title && testData.title.length > 20 ? `${testData?.title?.substring(0, 20)}...` : testData?.title || 'Test name', href: `/playground/${id}` },
    { label: "Playground", isCurrentPage: true },
  ];

  // Memoize initialTestData with proper type mapping
  const initialTestDataMemo = useMemo(() => {
    if (!testData) return undefined;
    
    // Map legacy types and validate
    let testType: ValidTestType = "browser";
    if (testData.type === "playwright") {
      testType = "browser";
    } else if (testData.type === "k6") {
      testType = "performance";
    } else if (isValidTestType(testData.type)) {
      testType = testData.type;
    }
    
    return {
      id: testData.id,
      title: testData.title || testData.name || "",
      description: testData.description || "",
      script: testData.script || "",
      priority: "medium" as const,
      type: testType,
      updatedAt: testData.updatedAt || undefined,
      createdAt: testData.createdAt || undefined,
    };
  }, [testData]);

  // Show loading skeleton while fetching test data
  if (isQueryLoading) {
    return <PlaygroundSkeleton />;
  }

  return (
    <div className="h-full flex flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <div className="relative flex-1 overflow-hidden">
        {initialTestDataMemo && (
          <Playground
            initialTestId={id}
            initialTestData={initialTestDataMemo}
          />
        )}
      </div>
    </div>
  );
}

// Main page component with Suspense that shows consistent loading UI
export default function PlaygroundPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PlaygroundIdClientBoundary />
    </Suspense>
  );
}
