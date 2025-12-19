"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useMemo, useEffect } from "react";
import { useParams, notFound } from "next/navigation";
import { PlaygroundSkeleton } from "@/components/playground/playground-skeleton";
import { useTest } from "@/hooks/use-tests";

// Using React Query hook for efficient caching - single source of truth for test data
export default function PlaygroundPage() {
  const params = useParams();
  const id = params.id as string;

  // Use React Query hook for test data - this caches for 60s and prevents duplicate fetches
  const { data: testData, isLoading, error } = useTest(id);

  // Redirect to not-found if test doesn't exist
  useEffect(() => {
    if (error || (!isLoading && !testData)) {
      notFound();
    }
  }, [error, isLoading, testData]);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Tests", href: "/tests" },
    { label: testData?.title && testData.title.length > 20 ? `${testData?.title?.substring(0, 20)}...` : testData?.title || 'Test name', href: `/playground/${id}` },
    { label: "Playground", isCurrentPage: true },
  ];

  // Memoize initialTestData to prevent unnecessary re-renders and effect triggers in Playground
  const initialTestDataMemo = useMemo(() => {
    if (!testData) return undefined;
    // Map Test type to Playground's expected format
    const testType = testData.type === "playwright" ? "browser" :
      testData.type === "k6" ? "performance" :
        (testData.type as "browser" | "api" | "custom" | "database" | "performance") || "browser";
    return {
      id: testData.id,
      title: testData.title || testData.name || "",
      description: testData.description || "",
      script: testData.script || "",
      priority: "medium" as const, // Default priority since Test type doesn't have it
      type: testType,
      updatedAt: testData.updatedAt || undefined,
      createdAt: testData.createdAt || undefined,
    };
  }, [testData]);

  return (
    <div className="h-full flex flex-col">
      <PageBreadcrumbs items={breadcrumbs} />
      <div className="relative flex-1 overflow-hidden">
        {isLoading && <PlaygroundSkeleton />}
        <div
          className={
            isLoading
              ? "opacity-0"
              : "opacity-100 transition-opacity duration-300"
          }
        >
          {initialTestDataMemo && (
            <Playground
              initialTestId={id}
              initialTestData={initialTestDataMemo}
            />
          )}
        </div>
      </div>
    </div>
  );
}

