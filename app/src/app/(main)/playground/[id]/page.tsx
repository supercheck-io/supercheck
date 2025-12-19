"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import React, { useMemo, useEffect, useState, Suspense } from "react";
import { useParams, notFound } from "next/navigation";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { useTest } from "@/hooks/use-tests";
import { cn } from "@/lib/utils";

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

// Client Boundary Component - handles test loading with React Query
function PlaygroundIdClientBoundary() {
  const params = useParams();
  const id = params.id as string;

  // LOCAL loading state - consistent between SSR and client hydration
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Use React Query hook for test data
  const { data: testData, isLoading: isQueryLoading, error } = useTest(id);

  // Combined loading: wait for both minimum loading time AND data to be ready
  const isLoading = isInitialLoading || isQueryLoading;

  // Set initial loading to false after a short delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitialLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // Redirect to not-found if test doesn't exist
  useEffect(() => {
    if (!isLoading && (error || !testData)) {
      notFound();
    }
  }, [error, isLoading, testData]);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Tests", href: "/tests" },
    { label: testData?.title && testData.title.length > 20 ? `${testData?.title?.substring(0, 20)}...` : testData?.title || 'Test name', href: `/playground/${id}` },
    { label: "Playground", isCurrentPage: true },
  ];

  // Memoize initialTestData
  const initialTestDataMemo = useMemo(() => {
    if (!testData) return undefined;
    const testType = testData.type === "playwright" ? "browser" :
      testData.type === "k6" ? "performance" :
        (testData.type as "browser" | "api" | "custom" | "database" | "performance") || "browser";
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

  // Show loading state
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
