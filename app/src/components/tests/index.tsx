"use client";

import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { useState, useEffect, useCallback } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
// import { useProjectContext } from "@/hooks/use-project-context"; // No longer needed
// import { getTests } from "@/actions/get-tests"; // Replaced with API call
import { Test } from "./schema";
import { Row } from "@tanstack/react-table";

export default function Tests() {
  const [selectedTest] = useState<Test | null>(null);
  const [tests, setTests] = useState<Test[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  // Remove projectId dependency since API handles project context automatically

  // Set mounted to true after initial render
  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
    };
  }, []);

  // Safe state setters that only run when component is mounted
  const safeSetTests = useCallback((tests: Test[] | ((prev: Test[]) => Test[])) => {
    if (mounted) {
      setTests(tests);
    }
  }, [mounted]);

  const safeSetIsLoading = useCallback((loading: boolean) => {
    if (mounted) {
      setIsLoading(loading);
    }
  }, [mounted]);

  // Fetch tests from the database
  useEffect(() => {
    async function fetchTests() {
      safeSetIsLoading(true);
      try {
        // API handles project context automatically, no need to check projectId

        const response = await fetch('/api/tests');
        const data = await response.json();
        
        if (response.ok && data) {
          const testsWithDefaults = data.map((test: { 
            priority?: string; 
            description?: string | null; 
            createdAt?: string; 
            updatedAt?: string;
            [key: string]: unknown;
          }) => ({
            ...test,
            priority: test.priority || "medium",
            description: test.description || null,
            createdAt: test.createdAt ?? undefined,
            updatedAt: test.updatedAt ?? undefined,
          }));
          safeSetTests(testsWithDefaults);
        } else {
          console.error("Failed to fetch tests:", data.error);
          safeSetTests([]);
        }
      } catch (error) {
        console.error("Error fetching tests:", error);
        safeSetTests([]);
      } finally {
        safeSetIsLoading(false);
      }
    }

    fetchTests();
  }, [safeSetTests, safeSetIsLoading]);

  const handleRowClick = (row: Row<Test>) => {
    const test = row.original;
    router.push(`/playground/${test.id}`);
  };

  const handleDeleteTest = (testId: string) => {
    safeSetTests((prevTests) => prevTests.filter((test) => test.id !== testId));
  };

  // Don't render until component is mounted
  if (!mounted) {
    return (
      <div className="flex h-full flex-col p-2 mt-6">
        <DataTableSkeleton columns={5} rows={3} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-2 mt-6">
      <DataTable
        columns={columns}
        data={tests}
        isLoading={isLoading}
        onRowClick={handleRowClick}
        meta={{
          onDeleteTest: handleDeleteTest,
        }}
      />

      {selectedTest && (
        <div className="space-y-2 py-2">
          <div>
            <h3 className="font-medium">Title</h3>
            <p>{selectedTest.title}</p>
          </div>
          <div>
            <h3 className="font-medium">Description</h3>
            <p>{selectedTest.description || "No description provided"}</p>
          </div>
          <div>
            <h3 className="font-medium">Priority</h3>
            <p className="capitalize">{selectedTest.priority}</p>
          </div>
          <div>
            <h3 className="font-medium">Type</h3>
            <p className="capitalize">{selectedTest.type}</p>
          </div>
          <div className="flex space-x-2 pt-4">
            <Button
              onClick={() => router.push(`/playground/${selectedTest.id}`)}
              className="flex-1"
            >
              Open in Playground
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
