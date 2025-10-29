"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Test } from "./schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { XCircle, Search, PlusIcon, AlertCircle, X, ChevronLeft, ChevronRight } from "lucide-react";
import { types } from "../tests/data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
// import { getTests } from "@/actions/get-tests"; // Replaced with API call

interface TestSelectorProps {
  selectedTests?: Test[];
  onTestsSelected: (tests: Test[]) => void;
  buttonLabel?: string;
  emptyStateMessage?: string;
  required?: boolean;
}

export default function TestSelector({
  selectedTests = [],
  onTestsSelected,
  buttonLabel = "Select Tests",
  emptyStateMessage = "No tests selected",
  required = true,
}: TestSelectorProps) {
  const [isSelectTestsDialogOpen, setIsSelectTestsDialogOpen] = useState(false);
  const [testSelections, setTestSelections] = useState<Record<string, boolean>>({});
  const [availableTests, setAvailableTests] = useState<Test[]>([]);
  const [isLoadingTests, setIsLoadingTests] = useState(true);
  const [testFilter, setTestFilter] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [testToRemove, setTestToRemove] = useState<{id: string, name: string} | null>(null);

  // Always ensure we have an array
  const tests = useMemo(() => Array.isArray(selectedTests) ? selectedTests : [], [selectedTests]);

  // Define the structure expected from the API
  interface ActionTest {
    id: string;
    title: string;
    description: string | null;
    type: "browser" | "api" | "custom" | "database";
    updatedAt: string | null;
    script?: string;
    priority?: string;
    createdAt?: string | null;
    tags?: Array<{ id: string; name: string; color: string | null }>;
  }

  // Fetch tests from database on component mount
  useEffect(() => {
    async function fetchTests() {
      setIsLoadingTests(true);
      try {
        const response = await fetch('/api/tests');
        const data = await response.json();
        
        if (response.ok && data) {
          // Map the API response to the Test type
          const formattedTests: Test[] = (data as ActionTest[]).map(
            (test: ActionTest) => {
              let mappedType: Test["type"];
              switch (test.type) {
                case "browser":
                case "api":
                case "custom":
                case "database":
                  mappedType = test.type;
                  break;
                default:
                  mappedType = "browser";
                  break;
              }
              return {
                id: test.id,
                name: test.title,
                description: test.description || null,
                type: mappedType,
                status: "running" as const,
                lastRunAt: test.updatedAt,
                duration: null as number | null,
                tags: test.tags || [],
              };
            },
          );
          setAvailableTests(formattedTests);
        } else {
          console.error("Failed to fetch tests:", data.error);
        }
      } catch (error) {
        console.error("Error fetching tests:", error);
      } finally {
        setIsLoadingTests(false);
      }
    }

    fetchTests();
  }, []);

  // Handle test selection
  const handleTestSelection = (testId: string, checked: boolean) => {
    setTestSelections((prev) => ({
      ...prev,
      [testId]: checked,
    }));
  };

  // Handle test selection confirmation
  const handleSelectTests = () => {
    const selected = availableTests.filter((test) => testSelections[test.id]);
    onTestsSelected(selected);
    setIsSelectTestsDialogOpen(false);
  };

  // Initialize test selections when dialog opens - with safe array
  useEffect(() => {
    if (isSelectTestsDialogOpen) {
      const initialSelections: Record<string, boolean> = {};
      availableTests.forEach((test) => {
        initialSelections[test.id] = tests.some(
          (selected) => selected.id === test.id
        );
      });
      setTestSelections(initialSelections);
    }
  }, [isSelectTestsDialogOpen, availableTests, tests]);

  // Remove a test from selection - using safe array
  const removeTest = (testId: string, testName: string) => {
    toast.success(`Removed test "${testName}"`);
    onTestsSelected(tests.filter((test) => test.id !== testId));
 
  };

  // Filter the tests based on search input
  const filteredTests = availableTests.filter((test) => {
    const matchesTextFilter = 
      testFilter === "" ||
      test.name.toLowerCase().includes(testFilter.toLowerCase()) ||
      test.id.toLowerCase().includes(testFilter.toLowerCase()) ||
      test.type.toLowerCase().includes(testFilter.toLowerCase()) ||
      (test.description && test.description.toLowerCase().includes(testFilter.toLowerCase())) ||
      (test.tags && test.tags.some(tag => tag.name.toLowerCase().includes(testFilter.toLowerCase())));

    return matchesTextFilter;
  });

  // Get the current page of tests
  const currentTests = filteredTests.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(filteredTests.length / itemsPerPage));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium">Selected Tests</h3>
          <p className="text-sm text-muted-foreground">
            Manage the tests associated with this job
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsSelectTestsDialogOpen(true)}
          className={cn(
            required && tests.length === 0 && "border-destructive",
            "transition-colors",
          )}
          size="sm"
        >
          <PlusIcon
            className={cn(
              "mr-2 h-4 w-4",
              required && tests.length === 0 && "text-destructive",
            )}
          />
          {buttonLabel}
        </Button>
      </div>

      {tests.length === 0 ? (
        <div className="text-center my-8">
          <p className={cn("text-sm flex items-center justify-center bg-muted/80 p-2 rounded-md w-fit mx-auto", required && "text-destructive")}>
            <AlertCircle className="h-4 w-4 mr-2" />
            {emptyStateMessage}
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "overflow-y-auto border rounded-md",
            tests.length > 5 && "max-h-[350px]",
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px] sticky top-0">
                  Test ID
                </TableHead>
                <TableHead className="w-[180px] sticky top-0">
                  Name
                </TableHead>
                <TableHead className="w-[120px] sticky top-0 ">
                  Type
                </TableHead>
                <TableHead className="w-[170px] sticky top-0">
                  Tags
                </TableHead>
                  <TableHead className="w-[170px]  sticky top-0">
                  Description
                </TableHead>
                <TableHead className="w-[100px] sticky top-0">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((test) => (
                <TableRow key={test.id} className="hover:bg-transparent">
                  <TableCell
                    className="font-mono text-sm truncate"
                    title={test.id}
                  >
                    <code className="font-mono text-xs bg-muted px-2 py-1.5 rounded truncate pr-1">
                      {test.id.substring(0, 12)}...
                    </code>
                  </TableCell>
                  <TableCell className="truncate" title={test.name || ""}>
                    {(test.name|| "").length > 40
                      ? (test.name  || "").substring(0, 40) + "..."
                      : (test.name || "")}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const type = types.find((t) => t.value === test.type);
                      if (!type) return null;
                      const Icon = type.icon;
                      return (
                        <div className="flex items-center w-[120px]">
                          {Icon && <Icon className={`mr-2 h-4 w-4 ${type.color}`} />}
                          <span>{type.label}</span>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {!test.tags || test.tags.length === 0 ? (
                      <div className="text-muted-foreground text-sm">
                        No tags
                      </div>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 min-h-[24px]">
                              {test.tags.slice(0, 2).map((tag) => (
                                <Badge 
                                  key={tag.id} 
                                  variant="secondary" 
                                  className="text-xs whitespace-nowrap flex-shrink-0"
                                  style={tag.color ? { 
                                    backgroundColor: tag.color + "20", 
                                    color: tag.color,
                                    borderColor: tag.color + "40"
                                  } : {}}
                                >
                                  {tag.name}
                                </Badge>
                              ))}
                              {test.tags.length > 2 && (
                                <Badge variant="secondary" className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                                  +{test.tags.length - 2}
                                </Badge>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[500px]">
                            <div className="flex flex-wrap gap-1">
                              {test.tags.map((tag) => (
                                <Badge 
                                  key={tag.id} 
                                  variant="secondary" 
                                  className="text-xs"
                                  style={tag.color ? { 
                                    backgroundColor: tag.color + "20", 
                                    color: tag.color,
                                    borderColor: tag.color + "40"
                                  } : {}}
                                >
                                  {tag.name}
                                </Badge>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
                  <TableCell
                    className="truncate"
                    title={test.description || ""}
                  >
                    {test.description && test.description.length > 50
                      ? test.description.substring(0, 50) + "..."
                      : test.description || "No description provided"}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTestToRemove({ id: test.id, name: test.name });
                        setShowRemoveDialog(true);
                      }}
                      onKeyDown={(e) => {
                        // Only trigger on Space, not Enter
                        if (e.key === "Enter") {
                          e.preventDefault();
                        }
                        if (e.key === " " || e.key === "Spacebar") {
                          setTestToRemove({ id: test.id, name: test.name });
                          setShowRemoveDialog(true);
                        }
                      }}
                      aria-label={`Remove test ${test.name}`}
                    >
                      <XCircle className="h-4 w-4 text-red-700" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={isSelectTestsDialogOpen}
        onOpenChange={setIsSelectTestsDialogOpen}
      >
        <DialogContent className="w-full min-w-[1100px]">
          <DialogHeader>
            <DialogTitle>Select Tests</DialogTitle>
            <DialogDescription className="flex justify-between items-center">
              <span>Choose the tests to include in this job</span>
              <span className="text-sm text-muted-foreground">Max: <span className="font-bold">50</span> tests per job</span>
            </DialogDescription>
          </DialogHeader>
          {isLoadingTests ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <span className="ml-2 text-muted-foreground">
                Loading tests...
              </span>
            </div>
          ) : (
            <>
              <div className="mb-4 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative w-[500px]">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter by test name, ID, type, tags, or description..."
                      className="pl-8"
                      value={testFilter}
                      onChange={(e) => setTestFilter(e.target.value)}
                    />
                      {testFilter.length > 0 && (
                        <button
                          type="reset"
                          className="absolute right-2 top-1/2 -translate-y-1/2  text-red-500 rounded-sm bg-red-200 p-0.5"
                          onClick={() => setTestFilter("")}
                          tabIndex={0}
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                  </div>
                    
         
                </div>
              </div>
              <div className="max-h-[500px] w-full overflow-y-auto rounded-sm">
                  <Table>
                    <TableHeader>
                      <TableRow>
                     <TableHead> </TableHead>
                        <TableHead className="w-[120px] sticky top-0 rounded-md">
                          ID
                        </TableHead>
                        <TableHead className="w-[250px] sticky top-0">
                          Name
                        </TableHead>
                        <TableHead className="w-[150px] sticky top-0">
                          Type
                        </TableHead>
                        <TableHead className="w-[200px] sticky top-0">
                          Tags
                        </TableHead>
                        <TableHead className="w-[200px] sticky top-0">
                          Description
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                  <TableBody>
                    {currentTests.map((test) => (
                      <TableRow
                        key={test.id} 
                        className="hover:bg-muted cursor-pointer transition-opacity"
                        onClick={() => handleTestSelection(test.id, !testSelections[test.id])}
                      >
                        <TableCell>
                          <Checkbox
                            checked={testSelections[test.id] || false}
                            onCheckedChange={(checked) =>
                              handleTestSelection(test.id, checked as boolean)
                            }
                            className="border-blue-600"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell
                          className="font-mono text-sm truncate"
                          title={test.id}
                        >
                          <code className="font-mono text-xs bg-muted px-2 py-1.5 rounded truncate pr-1">
                            {test.id.substring(0, 6)}...
                          </code>
                        </TableCell>
                        <TableCell className="truncate" title={test.name || ""}>
                          {(test.name || "").length > 40
                            ? (test.name || "").substring(0, 40) + "..."
                            : (test.name || "")}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const type = types.find((t) => t.value === test.type);
                            if (!type) return null;
                            const Icon = type.icon;
                            return (
                              <div className="flex items-center w-[120px]">
                                {Icon && <Icon className={`mr-2 h-4 w-4 ${type.color}`} />}
                                <span>{type.label}</span>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          {!test.tags || test.tags.length === 0 ? (
                            <div className="text-muted-foreground text-sm">
                              No tags
                            </div>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1 min-h-[24px]">
                                    {test.tags.slice(0, 2).map((tag) => (
                                      <Badge 
                                        key={tag.id} 
                                        variant="secondary" 
                                        className="text-xs whitespace-nowrap flex-shrink-0"
                                        style={tag.color ? { 
                                          backgroundColor: tag.color + "20", 
                                          color: tag.color,
                                          borderColor: tag.color + "40"
                                        } : {}}
                                      >
                                        {tag.name}
                                      </Badge>
                                    ))}
                                    {test.tags.length > 2 && (
                                      <Badge variant="secondary" className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                                        +{test.tags.length - 2}
                                      </Badge>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[300px]">
                                  <div className="flex flex-wrap gap-1">
                                    {test.tags.map((tag) => (
                                      <Badge 
                                        key={tag.id} 
                                        variant="secondary" 
                                        className="text-xs"
                                        style={tag.color ? { 
                                          backgroundColor: tag.color + "20", 
                                          color: tag.color,
                                          borderColor: tag.color + "40"
                                        } : {}}
                                      >
                                        {tag.name}
                                      </Badge>
                                    ))}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </TableCell>
                        <TableCell
                          className="truncate"
                          title={test.description || ""}
                        >
                          {test.description && test.description.length > 40 
                            ? test.description.substring(0, 40) + "..."
                            : test.description || "No description provided"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-center items-center mt-4 space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(prev - 1, 1))
                  }
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                  }
                  disabled={currentPage === totalPages}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-4 flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                    <span className="font-bold">{
                    Object.keys(testSelections).filter(
                      (id) => testSelections[id],
                    ).length
                  }{" "} </span>
                    of <span className="font-bold">{availableTests.length}</span> test
                    {availableTests.length !== 1
                    ? "s"
                    : ""}{" "}
                  selected
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsSelectTestsDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSelectTests}>
                    Add Selected Tests
                  </Button>
                </DialogFooter>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      {showRemoveDialog && testToRemove && (
  <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove Test from Job</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to remove <span className="font-semibold">&quot;{testToRemove.name}&quot;</span> from this job?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => {
            removeTest(testToRemove.id, testToRemove.name);
            setShowRemoveDialog(false);
            setTestToRemove(null);
          }}
          className="bg-red-600 hover:bg-red-700"
        >
          Remove
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)}
    </div>
  );
} 