"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Test } from "@/components/jobs/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  XCircle,
  Search,
  PlusIcon,
  AlertCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { types } from "@/components/tests/data";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTests } from "@/hooks/use-tests";

interface TestSelectorProps {
  selectedTests?: Test[];
  onTestsSelected: (tests: Test[]) => void;
  buttonLabel?: string;
  emptyStateMessage?: string;
  required?: boolean;
  performanceMode?: boolean; // For k6 jobs - single test with radio buttons
  testTypeFilter?: Test["type"]; // For synthetic monitors - filter by specific test type (e.g., "browser" for playwright)
  hideButton?: boolean; // For synthetic monitors - hide button when test is already selected
  singleSelection?: boolean; // Force single test selection regardless of mode
  excludeTypes?: Test["type"][]; // Exclude specific test types from the selector
  dialogTitle?: string;
  dialogDescription?: string;
  maxSelectionLabel?: React.ReactNode;
  entityName?: string;
  hideExecutionOrder?: boolean;
  headerActions?: React.ReactNode;
}

export default function TestSelector({
  selectedTests = [],
  onTestsSelected,
  buttonLabel = "Select Tests",
  emptyStateMessage = "No tests selected",
  required = true,
  performanceMode = false,
  testTypeFilter,
  hideButton = false,
  singleSelection = false,
  excludeTypes = [],
  dialogTitle,
  dialogDescription,
  maxSelectionLabel,
  entityName = "job",
  hideExecutionOrder = false,
  headerActions,
}: TestSelectorProps) {
  const [isSelectTestsDialogOpen, setIsSelectTestsDialogOpen] = useState(false);
  // Track selection order: key = testId, value = sequence number (1-based, 0 = not selected)
  const [testSelections, setTestSelections] = useState<Record<string, number>>(
    {}
  );
  const [testFilter, setTestFilter] = useState("");
  // Debounced search query for server-side filtering
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Track if search is pending (user typed but debounce hasn't fired yet)
  const isSearchPending = testFilter !== debouncedSearch;

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [testToRemove, setTestToRemove] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Debounce search input to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(testFilter);
      // Reset to page 1 when search changes
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [testFilter]);

  const excludeTypesKey = excludeTypes.length
    ? [...excludeTypes].sort().join("|")
    : "";

  // Always ensure we have an array
  const tests = useMemo(
    () => (Array.isArray(selectedTests) ? selectedTests : []),
    [selectedTests]
  );

  // Determine the type filter for the API based on mode
  const apiTypeFilter = useMemo(() => {
    if (testTypeFilter) return testTypeFilter;
    if (performanceMode) return "performance";
    return undefined;
  }, [testTypeFilter, performanceMode]);

  // Use React Query hook with server-side search and pagination
  // PERFORMANCE OPTIMIZATION:
  // 1. Exclude script content (reduces payload from MB to KB)
  // 2. Use server-side search for large datasets
  // 3. Fetch reasonable page size for the dialog (200 items)
  const { tests: fetchedTests, loading: isHookLoading } = useTests({
    enabled: true,
    limit: 200, // Fetch 200 tests per request (lightweight without scripts)
    includeScript: false,
    search: debouncedSearch || undefined, // Server-side search
    type: apiTypeFilter, // Server-side type filter
  });

  // Derive availableTests using useMemo instead of useEffect + setState
  // This avoids the cascading render issue flagged by ESLint
  // NOTE: Type filtering is now done server-side via apiTypeFilter
  // We only need to handle excludeTypes and format the data here
  const availableTests = useMemo(() => {
    if (!fetchedTests) return [];

    // Map the API response to the Test type
    let formattedTests: Test[] = fetchedTests.map((test) => {
      // Ensure type consistency
      let mappedType: Test["type"];
      // The hook returns properly typed Test objects, but we ensure safety
      switch (test.type) {
        case "browser":
        case "api":
        case "custom":
        case "database":
        case "performance":
          mappedType = test.type;
          break;
        default:
          mappedType = "browser";
          break;
      }
      return {
        ...test,
        name: test.name || "Unnamed Test",
        description: test.description ?? null,
        type: mappedType,
        status: "running" as const,
      };
    });

    // For non-performance mode without specific type filter, exclude performance tests
    // This is a client-side filter for the default case where we want all types except performance
    if (!testTypeFilter && !performanceMode) {
      formattedTests = formattedTests.filter(
        (test) => test.type !== "performance"
      );
    }

    // Apply excludeTypes filter (client-side, since API doesn't support exclude)
    if (excludeTypesKey.length > 0) {
      const excludeTypesSet = new Set(excludeTypesKey.split("|"));
      formattedTests = formattedTests.filter((test) => {
        return !excludeTypesSet.has(test.type);
      });
    }

    return formattedTests;
  }, [fetchedTests, performanceMode, testTypeFilter, excludeTypesKey]);

  // Derive loading state from hook loading state
  const isLoadingTests = isHookLoading;

  const useSingleSelection =
    performanceMode || !!testTypeFilter || singleSelection;

  // Handle test selection with order tracking
  const handleTestSelection = (testId: string, checked: boolean) => {
    if (useSingleSelection) {
      // Single test selection (radio button mode)
      setTestSelections(checked ? { [testId]: 1 } : {});
    } else {
      // Multiple test selection (checkbox mode) - track selection order
      setTestSelections((prev) => {
        if (checked) {
          // Add with next sequence number
          const currentMax = Math.max(
            0,
            ...Object.values(prev).filter((v) => v > 0)
          );
          return { ...prev, [testId]: currentMax + 1 };
        } else {
          // Remove and resequence remaining selections
          const removedOrder = prev[testId] || 0;
          const newSelections: Record<string, number> = {};
          Object.entries(prev).forEach(([id, order]) => {
            if (id !== testId && order > 0) {
              // Decrement order for items that were after the removed one
              newSelections[id] = order > removedOrder ? order - 1 : order;
            }
          });
          return newSelections;
        }
      });
    }
  };

  // Handle test selection confirmation - preserve selection order
  const handleSelectTests = () => {
    // Get selected tests sorted by their selection order
    const selected = availableTests
      .filter((test) => testSelections[test.id] > 0)
      .sort((a, b) => testSelections[a.id] - testSelections[b.id]);
    onTestsSelected(selected);
    setIsSelectTestsDialogOpen(false);
  };

  // Open dialog and initialize test selections - moved from useEffect to event handler
  // This avoids the cascading render issue flagged by ESLint
  const openTestSelectionDialog = () => {
    const initialSelections: Record<string, number> = {};
    // Preserve the order from the existing tests array (index + 1 for 1-based)
    tests.forEach((test, index) => {
      initialSelections[test.id] = index + 1;
    });
    setTestSelections(initialSelections);
    setIsSelectTestsDialogOpen(true);
  };

  // Remove a test from selection - using safe array
  const removeTest = (testId: string, testName: string) => {
    toast.success(`Removed test "${testName}"`);
    onTestsSelected(tests.filter((test) => test.id !== testId));
  };

  // With server-side search, availableTests is already filtered by title
  // We keep a lightweight client-side filter for additional fields (ID, type, tags, description)
  // This provides instant feedback while the server search covers the main use case
  const filteredTests = useMemo(() => {
    // If no filter or search is already server-side (matches title), use availableTests directly
    if (!testFilter) return availableTests;

    // For non-title searches (ID, type, tags), do client-side filtering
    // The server already filtered by title, so this catches edge cases
    const lowerFilter = testFilter.toLowerCase();
    return availableTests.filter((test) => {
      // Title is already filtered server-side, but include for instant local matching
      const matchesName = test.name.toLowerCase().includes(lowerFilter);
      const matchesId = test.id.toLowerCase().includes(lowerFilter);
      const matchesType = test.type.toLowerCase().includes(lowerFilter);
      const matchesDescription = test.description
        ?.toLowerCase()
        .includes(lowerFilter);
      const matchesTags = test.tags?.some((tag) =>
        tag.name.toLowerCase().includes(lowerFilter)
      );

      return (
        matchesName ||
        matchesId ||
        matchesType ||
        matchesDescription ||
        matchesTags
      );
    });
  }, [availableTests, testFilter]);

  // Get the current page of tests
  const currentTests = filteredTests.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Calculate total pages
  const totalPages = Math.max(
    1,
    Math.ceil(filteredTests.length / itemsPerPage)
  );

  const dialogTitleText =
    dialogTitle ??
    (testTypeFilter
      ? "Select Playwright Test"
      : performanceMode
        ? "Select Performance Test"
        : useSingleSelection
          ? "Select Test"
          : "Select Tests");

  const dialogDescriptionText =
    dialogDescription ??
    (testTypeFilter
      ? `Choose a Playwright test to link to this ${entityName}`
      : performanceMode
        ? `Choose a performance test to run in this ${entityName}`
        : useSingleSelection
          ? `Choose the test to include in this ${entityName}`
          : hideExecutionOrder
            ? `Select tests to link. Use the checkboxes to select multiple tests.`
            : `Select tests in the sequence you want them to execute. Tests run one after another in the order shown by the # column.`);

  const headerNote =
    maxSelectionLabel !== undefined ? (
      maxSelectionLabel
    ) : performanceMode ? (
      <>
        Max: <span className="font-bold">1</span> performance test per{" "}
        {entityName}
      </>
    ) : !testTypeFilter && !singleSelection ? (
      <>
        Max: <span className="font-bold">50</span> tests per {entityName}
      </>
    ) : undefined;

  const selectedTestsTitle = performanceMode
    ? "Selected Performance Test"
    : "Selected Tests";

  const selectedTestsDescription = performanceMode
    ? `Only one performance test can be attached to k6 ${entityName}.`
    : hideExecutionOrder
      ? "Manage linked tests."
      : "Tests execute sequentially in the order shown below.";

  const pageHeaderNote = performanceMode ? undefined : headerNote;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h3 className="text-lg font-medium">{selectedTestsTitle}</h3>
          <p className="text-sm text-muted-foreground">
            {selectedTestsDescription}
          </p>
          {pageHeaderNote && (
            <p className="mt-1 text-xs text-muted-foreground">
              {pageHeaderNote}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {headerActions}
          {!hideButton && (
            <Button
              type="button"
              variant="outline"
              onClick={openTestSelectionDialog}
              className={cn(
                required && tests.length === 0 && "border-destructive",
                "transition-colors"
              )}
              size="sm"
            >
              <PlusIcon
                className={cn(
                  "mr-2 h-4 w-4",
                  required && tests.length === 0 && "text-destructive"
                )}
              />
              {buttonLabel}
            </Button>
          )}
        </div>
      </div>

      {tests.length === 0 ? (
        <div className="flex justify-center my-8">
          <Badge
            variant="outline"
            className={cn(
              "py-1.5 px-4 text-sm font-normal",
              required
                ? "text-red-500 border-red-900/50 bg-red-900/10 hover:bg-red-900/20"
                : "text-muted-foreground"
            )}
          >
            <AlertCircle className="h-4 w-4 mr-2" />
            {emptyStateMessage}
          </Badge>
        </div>
      ) : (
        <div
          className={cn(
            "overflow-y-auto border rounded-md",
            tests.length > 5 && "max-h-[350px]"
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                {!useSingleSelection && !hideExecutionOrder && (
                  <TableHead className="w-[50px] sticky top-0 text-center">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help font-medium">#</span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>Execution order - tests run sequentially</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                )}
                <TableHead className="w-[120px] sticky top-0">
                  Test ID
                </TableHead>
                <TableHead className="w-[180px] sticky top-0">Name</TableHead>
                <TableHead className="w-[120px] sticky top-0 ">Type</TableHead>
                <TableHead className="w-[170px] sticky top-0">Tags</TableHead>
                <TableHead className="w-[150px]  sticky top-0">
                  Description
                </TableHead>
                <TableHead className="w-[80px] sticky top-0">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map((test, index) => (
                <TableRow key={test.id} className="hover:bg-transparent">
                  {!useSingleSelection && !hideExecutionOrder && (
                    <TableCell className="text-center">
                      <Badge
                        variant="secondary"
                        className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-mono min-w-[28px] justify-center"
                      >
                        {index + 1}
                      </Badge>
                    </TableCell>
                  )}
                  <TableCell
                    className="font-mono text-sm truncate"
                    title={test.id}
                  >
                    <code className="font-mono text-xs bg-muted px-2 py-1.5 rounded truncate pr-1">
                      {test.id.substring(0, 12)}...
                    </code>
                  </TableCell>
                  <TableCell className="truncate" title={test.name || ""}>
                    {(test.name || "").length > 40
                      ? (test.name || "").substring(0, 40) + "..."
                      : test.name || ""}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const type = types.find((t) => t.value === test.type);
                      if (!type) return null;
                      const Icon = type.icon;
                      return (
                        <div className="flex items-center w-[120px]">
                          {Icon && (
                            <Icon className={`mr-2 h-4 w-4 ${type.color}`} />
                          )}
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
                                  style={
                                    tag.color
                                      ? {
                                          backgroundColor: tag.color + "20",
                                          color: tag.color,
                                          borderColor: tag.color + "40",
                                        }
                                      : {}
                                  }
                                >
                                  {tag.name}
                                </Badge>
                              ))}
                              {test.tags.length > 2 && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0"
                                >
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
                                  style={
                                    tag.color
                                      ? {
                                          backgroundColor: tag.color + "20",
                                          color: tag.color,
                                          borderColor: tag.color + "40",
                                        }
                                      : {}
                                  }
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
            <DialogTitle>{dialogTitleText}</DialogTitle>
            <DialogDescription className="flex justify-between items-center">
              <span>{dialogDescriptionText}</span>
              {headerNote && (
                <span className="text-sm text-muted-foreground">
                  {headerNote}
                </span>
              )}
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
              <div className="mb-4">
                <div className="relative w-full">
                  {isSearchPending || isHookLoading ? (
                    <Loader2 className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground animate-spin" />
                  ) : (
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  )}
                  <Input
                    placeholder={
                      performanceMode
                        ? "Search by test name..."
                        : "Search by test name, ID, type, tags..."
                    }
                    className="pl-8"
                    value={testFilter}
                    onChange={(e) => setTestFilter(e.target.value)}
                  />
                  {testFilter.length > 0 && (
                    <button
                      type="reset"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-red-500 rounded-sm bg-red-200 p-0.5"
                      onClick={() => setTestFilter("")}
                      tabIndex={0}
                      aria-label="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Table view for both performance and regular modes */}
              <div className="max-h-[500px] w-full overflow-y-auto rounded-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      {!useSingleSelection && !hideExecutionOrder && (
                        <TableHead className="w-[50px] sticky top-0 text-center">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help font-medium">
                                  #
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p>
                                  Execution order - tests run sequentially in
                                  this order
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableHead>
                      )}
                      <TableHead className="w-[120px] sticky top-0">
                        ID
                      </TableHead>
                      <TableHead className="w-[220px] sticky top-0">
                        Name
                      </TableHead>
                      <TableHead className="w-[130px] sticky top-0">
                        Type
                      </TableHead>
                      <TableHead className="w-[180px] sticky top-0">
                        Tags
                      </TableHead>
                      <TableHead className="w-[180px] sticky top-0">
                        Description
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentTests.map((test) => (
                      <TableRow
                        key={test.id}
                        className="hover:bg-muted cursor-pointer transition-opacity"
                        onClick={() =>
                          handleTestSelection(test.id, !testSelections[test.id])
                        }
                      >
                        <TableCell>
                          {useSingleSelection ? (
                            // Radio button for single-selection modes
                            <RadioGroup
                              value={
                                Object.keys(testSelections).find(
                                  (k) => testSelections[k]
                                ) || ""
                              }
                              onValueChange={(value) =>
                                handleTestSelection(value, true)
                              }
                            >
                              <Label className="flex items-center cursor-pointer">
                                <RadioGroupItem
                                  value={test.id}
                                  checked={!!testSelections[test.id]}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </Label>
                            </RadioGroup>
                          ) : (
                            // Checkbox for regular mode
                            <Checkbox
                              checked={!!testSelections[test.id]}
                              onCheckedChange={(checked) =>
                                handleTestSelection(test.id, checked as boolean)
                              }
                              className="border-blue-600"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </TableCell>
                        {!useSingleSelection && !hideExecutionOrder && (
                          <TableCell className="text-center">
                            {testSelections[test.id] ? (
                              <Badge
                                variant="secondary"
                                className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-mono min-w-[28px] justify-center"
                              >
                                {testSelections[test.id]}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        )}
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
                            : test.name || ""}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const type = types.find(
                              (t) => t.value === test.type
                            );
                            if (!type) return null;
                            const Icon = type.icon;
                            return (
                              <div className="flex items-center w-[120px]">
                                {Icon && (
                                  <Icon
                                    className={`mr-2 h-4 w-4 ${type.color}`}
                                  />
                                )}
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
                                        style={
                                          tag.color
                                            ? {
                                                backgroundColor:
                                                  tag.color + "20",
                                                color: tag.color,
                                                borderColor: tag.color + "40",
                                              }
                                            : {}
                                        }
                                      >
                                        {tag.name}
                                      </Badge>
                                    ))}
                                    {test.tags.length > 2 && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0"
                                      >
                                        +{test.tags.length - 2}
                                      </Badge>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  className="max-w-[300px]"
                                >
                                  <div className="flex flex-wrap gap-1">
                                    {test.tags.map((tag) => (
                                      <Badge
                                        key={tag.id}
                                        variant="secondary"
                                        className="text-xs"
                                        style={
                                          tag.color
                                            ? {
                                                backgroundColor:
                                                  tag.color + "20",
                                                color: tag.color,
                                                borderColor: tag.color + "40",
                                              }
                                            : {}
                                        }
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

              {/* Pagination */}
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

              {/* Footer with selected count */}
              <div className="mt-4 flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                  {useSingleSelection ? (
                    <span>
                      {Object.keys(testSelections).filter(
                        (id) => testSelections[id] > 0
                      ).length > 0
                        ? "1 test selected"
                        : "No test selected"}
                    </span>
                  ) : (
                    <>
                      <span className="font-bold">
                        {
                          Object.keys(testSelections).filter(
                            (id) => testSelections[id] > 0
                          ).length
                        }
                      </span>{" "}
                      of{" "}
                      <span className="font-bold">{availableTests.length}</span>{" "}
                      test
                      {availableTests.length !== 1 ? "s" : ""} selected
                    </>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsSelectTestsDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSelectTests}>
                    {useSingleSelection ? "Select Test" : "Add Selected Tests"}
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
              <AlertDialogTitle>Remove Test from {entityName}</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove{" "}
                <span className="font-semibold">
                  &quot;{testToRemove.name}&quot;
                </span>{" "}
                from this {entityName}?
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
