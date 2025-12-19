"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useMemo, Suspense } from "react";
import { useParams } from "next/navigation";
import { useTest } from "@/hooks/use-tests";
import { PlaygroundSkeleton } from "@/components/playground/playground-skeleton";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

// Loading fallback component - shows skeleton during initial load
function LoadingFallback() {
  return <PlaygroundSkeleton />;
}

// Not found component - shown when test doesn't exist (rendered inline, not via notFound())
function TestNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-3xl font-bold mb-2">Test Not Found</h1>
        <p className="text-muted-foreground mb-6">
          The test you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>
        <div className="flex gap-4">
          <Link
            href="/tests"
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            Back to Tests
          </Link>
        </div>
      </div>
    </div>
  );
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
    
    // Validate priority value
    const validPriorities = ["low", "medium", "high"] as const;
    const priority = testData.priority && validPriorities.includes(testData.priority as typeof validPriorities[number])
      ? (testData.priority as "low" | "medium" | "high")
      : "medium";
    
    return {
      id: testData.id,
      title: testData.title || testData.name || "",
      description: testData.description || "",
      script: testData.script || "",
      priority,
      type: testType,
      updatedAt: testData.updatedAt || undefined,
      createdAt: testData.createdAt || undefined,
    };
  }, [testData]);

  // Show loading skeleton while fetching test data
  if (isQueryLoading) {
    return <PlaygroundSkeleton />;
  }

  // Show not-found state if test doesn't exist or error occurred
  // This is rendered inline instead of calling notFound() since we're in a client component
  if (error || !testData) {
    return <TestNotFound />;
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
