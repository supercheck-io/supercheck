"use client";
import Playground from "@/components/playground";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
// import { getTest } from "@/actions/get-test"; // Replaced with API call
import { useEffect, useState, useMemo } from "react";
import { useParams, notFound } from "next/navigation";
import { TestPriority, TestType } from "@/db/schema";
import { PlaygroundSkeleton } from "@/components/playground/playground-skeleton";

// Converting to a client component
export default function PlaygroundPage() {
  const params = useParams();
  const id = params.id as string;

  const [isLoading, setIsLoading] = useState(true);
  const [testData, setTestData] = useState<{
    id: string;
    title: string;
    description: string | null;
    script: string;
    priority: TestPriority;
    type: TestType;
    updatedAt?: string | null;
    createdAt?: string | null;
  } | null>(null);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Tests", href: "/tests" },
    { label: testData?.title && testData.title.length > 20 ? `${testData?.title?.substring(0, 20)}...` : testData?.title || 'Test name', href: `/playground/${id}` },
    { label: "Playground", isCurrentPage: true },
  ];

  // Fetch test data and set loading state
  useEffect(() => {
    async function fetchTestData() {
      try {
        const response = await fetch(`/api/tests/${id}`);
        const result = await response.json();

        if (response.ok && result) {
          setTestData({
            ...result,
            updatedAt: result.updatedAt || null,
            createdAt: result.createdAt || null,
          });
        } else {
          // Test not found or error, trigger the not-found page
          notFound();
        }
      } catch (error) {
        console.error("Error loading test:", error);
        notFound();
      } finally {
        // Set loading to false after a delay to ensure UI is ready
        setTimeout(() => {
          setIsLoading(false);
        }, 1500);
      }
    }

    fetchTestData();
  }, [id]);

  // Memoize initialTestData to prevent unnecessary re-renders and effect triggers in Playground
  const initialTestDataMemo = useMemo(() => {
    if (!testData) return undefined;
    return {
      id: testData.id,
      title: testData.title,
      description: testData.description || "",
      script: testData.script,
      priority: testData.priority,
      type: testData.type,
      updatedAt: testData.updatedAt || undefined,
      createdAt: testData.createdAt || undefined,
    };
  }, [testData]);

  // If no test data is available and we're done loading, don't try to render the playground
  if (!isLoading && !testData) {
    notFound();
    return null;
  }

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
