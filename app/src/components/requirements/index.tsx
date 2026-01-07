"use client";

import React, { useState, useCallback, useMemo, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Row } from "@tanstack/react-table";
import { columns } from "./columns";
import { DataTable } from "./data-table";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UUIDField } from "@/components/ui/uuid-field";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    CalendarIcon,
    ClockIcon,
    Pencil,
    Trash2,

    ExternalLink,
    CheckCircle,
    XCircle,
    CircleDashed,
    FileText,
    ArrowUp,
    ArrowRight,
    ArrowDown,

    Target,
    Info,
    Plus,

    Chrome,
    ArrowLeftRight,
    Database,
    SquareFunction,
    Sparkles,
} from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { K6Logo } from "@/components/logo/k6-logo";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useRequirements, useRequirementMutations } from "@/hooks/use-requirements";
import { useTags } from "@/hooks/use-tags";
import { useRequirementPermissions } from "@/hooks/use-rbac-permissions";

import { getLinkedTests } from "@/actions/requirements";
import { useQuery } from "@tanstack/react-query";
import { Requirement } from "./schema";
import { RequirementWithCoverage } from "@/actions/requirements";
import { RequirementTestDataTable } from "./requirement-test-data-table";
import { createRequirementTestColumns } from "./requirement-test-columns";
import { DocumentsList } from "./documents-list";

// ============================================================================
// CONFIG
// ============================================================================

const statusConfig = {
    covered: { label: "Covered", icon: CheckCircle, color: "text-green-500", bgColor: "bg-green-500/10" },
    failing: { label: "Failing", icon: XCircle, color: "text-red-500", bgColor: "bg-red-500/10" },
    missing: { label: "Missing", icon: CircleDashed, color: "text-gray-400", bgColor: "bg-gray-400/10" },
} as const;

const priorityConfig = {
    high: { label: "High", icon: ArrowUp, color: "text-orange-500", bgColor: "bg-orange-500/10" },
    medium: { label: "Medium", icon: ArrowRight, color: "text-yellow-500", bgColor: "bg-yellow-500/10" },
    low: { label: "Low", icon: ArrowDown, color: "text-gray-400", bgColor: "bg-gray-400/10" },
} as const;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RequirementsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { canCreateRequirement, canEditRequirement, canDeleteRequirement } = useRequirementPermissions();



    const isMounted = useSyncExternalStore(
        () => () => { },
        () => true,
        () => false
    );

    // Fetch requirements with React Query
    const { requirements: rawRequirements, isLoading, invalidate } = useRequirements();
    const { deleteRequirement: deleteMutation } = useRequirementMutations();

    // Fetch available tags for coloring
    const { tags: availableTags } = useTags();

    // Transform to UI format
    const requirements = useMemo<Requirement[]>(() => {
        if (!rawRequirements) return [];
        return rawRequirements.map((r: RequirementWithCoverage) => ({
            ...r,
            tags: r.tags
                ? r.tags.split(",").map((name, index) => {
                    const tagName = name.trim().toLowerCase();
                    // Find actual tag from DB to get color
                    const dbTag = availableTags.find(t => t.name.toLowerCase() === tagName);

                    return {
                        id: `tag-${r.id}-${index}`,
                        name: tagName,
                        // Priority: "ai" override > DB color > null
                        color: tagName === "ai" ? "#a855f7" : (dbTag?.color || null),
                    };
                })
                : [],
        }));
    }, [rawRequirements, availableTags]);

    // URL-based selected requirement
    const requirementIdFromUrl = searchParams.get("id");
    const selectedRequirement = useMemo(() => {
        if (!requirementIdFromUrl || requirements.length === 0) return null;
        return requirements.find((r) => r.id === requirementIdFromUrl) || null;
    }, [requirementIdFromUrl, requirements]);
    const isSheetOpen = !!selectedRequirement;

    // Fetch linked tests for selected requirement
    const { data: linkedTests = [], isLoading: testsLoading } = useQuery({
        queryKey: ["requirement-tests", selectedRequirement?.id],
        queryFn: () => selectedRequirement ? getLinkedTests(selectedRequirement.id) : [],
        enabled: !!selectedRequirement,
    });




    const handleRowClick = useCallback((row: Row<Requirement>) => {
        // Invalidate cache to get fresh data when opening the sheet
        invalidate();
        const params = new URLSearchParams(searchParams);
        params.set("id", row.original.id);
        router.push(`/requirements?${params.toString()}`, { scroll: false });
    }, [searchParams, router, invalidate]);

    // Handle sheet close
    const handleSheetClose = useCallback(() => {
        const params = new URLSearchParams(searchParams);
        params.delete("id");
        const newUrl = params.toString() ? `/requirements?${params.toString()}` : "/requirements";
        router.push(newUrl, { scroll: false });
    }, [searchParams, router]);

    // Delete confirmation dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [requirementToDelete, setRequirementToDelete] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Handle delete - opens confirmation dialog
    const handleDeleteClick = useCallback((id: string) => {
        setRequirementToDelete(id);
        setDeleteDialogOpen(true);
    }, []);

    // Confirm and execute delete
    const handleConfirmDelete = useCallback(async () => {
        if (!requirementToDelete) return;
        setIsDeleting(true);
        try {
            await deleteMutation.mutateAsync(requirementToDelete);
            toast.success("Requirement deleted");
            handleSheetClose();
        } catch (error) {
            toast.error("Failed to delete requirement");
        } finally {
            setIsDeleting(false);
            setDeleteDialogOpen(false);
            setRequirementToDelete(null);
        }
    }, [requirementToDelete, deleteMutation, handleSheetClose]);

    // Handle edit - navigate to edit page
    const handleEdit = useCallback((id: string) => {
        router.push(`/requirements/edit/${id}`);
    }, [router]);



    // Format helpers
    const formatDate = (date: Date | string | null) => {
        if (!date) return "Not set";
        const d = new Date(date);
        return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const formatRelativeDate = (date: Date | string | null) => {
        if (!date) return "Not set";
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return "Invalid date";
            return formatDistanceToNow(d, { addSuffix: true });
        } catch {
            return "Invalid date";
        }
    };

    const testColumns = useMemo(() => createRequirementTestColumns({
        onView: (testId) => window.open(`/playground/${testId}`, '_blank'),
    }), []);

    // Don't render until mounted
    if (!isMounted) {
        return (
            <div className="flex h-full flex-col space-y-2 p-2 w-full max-w-full overflow-x-hidden">
                <DataTableSkeleton columns={6} rows={3} />
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col space-y-2 p-2 w-full max-w-full overflow-x-hidden">
            <Tabs defaultValue="requirements" className="w-full mt-2">
                <TabsList>
                    <TabsTrigger value="requirements" className="gap-2">
                        <Target className="h-4 w-4" />
                        Requirements
                    </TabsTrigger>
                    <TabsTrigger value="documents" className="gap-2">
                        <FileText className="h-4 w-4" />
                        Documents
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="requirements" className="mt-0 pt-4">
                    <DataTable
                        columns={columns}
                        data={requirements}
                        isLoading={isLoading}
                        onRowClick={handleRowClick}
                        meta={{
                            onDeleteRequirement: handleDeleteClick,
                            onEditRequirement: handleEdit,
                            canEdit: canEditRequirement,
                            canDelete: canDeleteRequirement,
                        }}
                    />
                </TabsContent>

                <TabsContent value="documents" className="mt-0 pt-4">
                    <DocumentsList canUpload={canCreateRequirement} />
                </TabsContent>
            </Tabs>

            {/* Requirement Detail Sheet */}
            <Sheet open={isSheetOpen} onOpenChange={(open) => !open && handleSheetClose()}>
                <SheetContent className="xl:max-w-[950px] lg:max-w-[800px] md:max-w-[700px] sm:max-w-[600px] overflow-y-auto p-8">
                    {selectedRequirement && (
                        <>
                            <SheetHeader>
                                <div className="flex items-center justify-between">
                                    <SheetTitle className="text-2xl font-semibold truncate max-w-[600px]" title={selectedRequirement.title}>
                                        {selectedRequirement.title}
                                    </SheetTitle>
                                    <div className="flex items-center space-x-2">
                                        {/* Edit Button */}
                                        {canEditRequirement && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => router.push(`/requirements/edit/${selectedRequirement.id}`)}
                                            >
                                                <Pencil className="h-4 w-4 mr-2" />
                                                Edit
                                            </Button>
                                        )}
                                        {canDeleteRequirement && (
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="destructive" size="sm">
                                                        <Trash2 className="h-4 w-4 mr-1" />
                                                        Delete
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Delete Requirement?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will permanently delete this requirement and unlink all tests.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleDeleteClick(selectedRequirement.id)}
                                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                        >
                                                            Delete
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        )}
                                    </div>
                                </div>
                            </SheetHeader>

                            <div className="space-y-2 mt-2">
                                {/* ID and Title Card */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-card p-4 rounded-lg border border-border/40">
                                    <div className="space-y-1">
                                        <h3 className="text-xs font-medium text-muted-foreground">
                                            Requirement ID
                                        </h3>
                                        <div className="group relative">
                                            <UUIDField
                                                value={selectedRequirement.id}
                                                className="text-sm font-mono"
                                                onCopy={() => toast.success("ID copied to clipboard")}
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <h3 className="text-xs font-medium text-muted-foreground">
                                            Title
                                        </h3>
                                        <p className="text-sm font-medium leading-tight">
                                            {selectedRequirement.title}
                                        </p>
                                    </div>
                                </div>

                                <Tabs defaultValue="details" className="mt-6">
                                    <TabsList className="grid w-full grid-cols-2">
                                        <TabsTrigger value="details">Details</TabsTrigger>
                                        <TabsTrigger value="tests">
                                            Linked Tests
                                            <code className="font-mono text-xs font-semibold px-2 py-0.5 bg-card rounded-sm ml-2">
                                                {selectedRequirement.linkedTestCount}
                                            </code>
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="details" className="py-2 space-y-4">
                                        {/* Status, Priority, Source Grid */}
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            {/* Status */}
                                            <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                                                <div className="flex items-center gap-1">
                                                    <h3 className="text-xs font-medium text-muted-foreground">Coverage Status</h3>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-5 w-5 p-0">
                                                                <Info className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
                                                                <span className="sr-only">Coverage info</span>
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-72 text-xs" align="start">
                                                            <p className="text-muted-foreground">
                                                                Coverage updates when jobs run. Single test runs from the playground do not affect coverage.
                                                            </p>
                                                        </PopoverContent>
                                                    </Popover>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    {(() => {
                                                        const status = statusConfig[selectedRequirement.coverageStatus];
                                                        const Icon = status.icon;
                                                        return (
                                                            <>
                                                                <Icon className={`h-5 w-5 ${status.color}`} />
                                                                <span className="text-sm font-medium">{status.label}</span>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            {/* Priority */}
                                            <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                                                <h3 className="text-xs font-medium text-muted-foreground">Priority</h3>
                                                <div className="flex items-center space-x-2">
                                                    {(() => {
                                                        const priority = priorityConfig[selectedRequirement.priority as keyof typeof priorityConfig];
                                                        if (!priority) {
                                                            return <span className="text-sm text-muted-foreground">Not set</span>;
                                                        }
                                                        const Icon = priority.icon;
                                                        return (
                                                            <>
                                                                <Icon className={`h-5 w-5 ${priority.color}`} />
                                                                <span className="text-sm font-medium">{priority.label}</span>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>

                                            {/* Source Document */}
                                            <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                                                <h3 className="text-xs font-medium text-muted-foreground">Source Document</h3>
                                                {selectedRequirement.sourceDocumentName ? (
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                                                            <FileText className="h-4 w-4 text-blue-500" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-medium truncate max-w-[150px]" title={selectedRequirement.sourceDocumentName}>
                                                                {selectedRequirement.sourceDocumentName}
                                                            </p>
                                                            {selectedRequirement.sourceSection && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    Section: {selectedRequirement.sourceSection}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center h-8">
                                                        <span className="text-sm text-muted-foreground italic">None linked</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Description */}
                                        <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                                            <h3 className="text-xs font-medium text-muted-foreground">Description</h3>
                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                                {selectedRequirement.description || "No description provided"}
                                            </p>
                                        </div>



                                        {/* Create Test Section */}
                                        <div className="space-y-3 bg-card p-4 rounded-lg border border-border/40">
                                            <div className="flex items-center gap-1">
                                                <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                                    <Plus className="h-3 w-3" /> Create Test
                                                </h3>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-5 w-5 p-0">
                                                            <Info className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
                                                            <span className="sr-only">Create test info</span>
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-80 text-xs space-y-3" align="start">
                                                        <div>
                                                            <p className="font-medium text-foreground mb-1">How to Create Tests</p>
                                                            <p className="text-muted-foreground">
                                                                Select a test type below to open the Playground with this requirement pre-loaded.
                                                            </p>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="flex gap-2">
                                                                <Chrome className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
                                                                <div>
                                                                    <p className="font-medium text-foreground">Browser Tests</p>
                                                                    <p className="text-muted-foreground">Use the Playwright Recorder to capture real user interactions for reliable, accurate tests.</p>
                                                                </div>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <Sparkles className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                                                                <div>
                                                                    <p className="font-medium text-foreground">API, Database, Custom & Performance</p>
                                                                    <p className="text-muted-foreground">AI generates a prompt from this requirement. Review, customize, and generate your test script.</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <p className="text-muted-foreground/80 text-xs border-t pt-2">
                                                            Tests saved from the Playground are automatically linked to this requirement.
                                                        </p>
                                                    </PopoverContent>
                                                </Popover>
                                            </div>
                                            <div className="grid grid-cols-5 gap-2">
                                                <button
                                                    onClick={() => router.push(`/playground?scriptType=browser&requirementId=${selectedRequirement.id}`)}
                                                    className="group flex flex-col items-center gap-2 p-4 rounded-lg border border-border/60 bg-background hover:bg-accent hover:border-sky-500/50 transition-all duration-200"
                                                >
                                                    <div className="p-2.5 rounded-lg bg-sky-100 dark:bg-sky-900/40 group-hover:bg-sky-200 dark:group-hover:bg-sky-900/60 transition-colors">
                                                        <Chrome className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                                                    </div>
                                                    <span className="text-xs font-medium text-foreground">Browser</span>
                                                </button>
                                                <button
                                                    onClick={() => router.push(`/playground?scriptType=api&requirementId=${selectedRequirement.id}`)}
                                                    className="group flex flex-col items-center gap-2 p-4 rounded-lg border border-border/60 bg-background hover:bg-accent hover:border-teal-500/50 transition-all duration-200"
                                                >
                                                    <div className="p-2.5 rounded-lg bg-teal-100 dark:bg-teal-900/40 group-hover:bg-teal-200 dark:group-hover:bg-teal-900/60 transition-colors">
                                                        <ArrowLeftRight className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                                                    </div>
                                                    <span className="text-xs font-medium text-foreground">API</span>
                                                </button>
                                                <button
                                                    onClick={() => router.push(`/playground?scriptType=database&requirementId=${selectedRequirement.id}`)}
                                                    className="group flex flex-col items-center gap-2 p-4 rounded-lg border border-border/60 bg-background hover:bg-accent hover:border-cyan-500/50 transition-all duration-200"
                                                >
                                                    <div className="p-2.5 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 group-hover:bg-cyan-200 dark:group-hover:bg-cyan-900/60 transition-colors">
                                                        <Database className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                                                    </div>
                                                    <span className="text-xs font-medium text-foreground">Database</span>
                                                </button>
                                                <button
                                                    onClick={() => router.push(`/playground?scriptType=custom&requirementId=${selectedRequirement.id}`)}
                                                    className="group flex flex-col items-center gap-2 p-4 rounded-lg border border-border/60 bg-background hover:bg-accent hover:border-blue-500/50 transition-all duration-200"
                                                >
                                                    <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60 transition-colors">
                                                        <SquareFunction className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                                    </div>
                                                    <span className="text-xs font-medium text-foreground">Custom</span>
                                                </button>
                                                <button
                                                    onClick={() => router.push(`/playground?scriptType=performance&requirementId=${selectedRequirement.id}`)}
                                                    className="group flex flex-col items-center gap-2 p-4 rounded-lg border border-border/60 bg-background hover:bg-accent hover:border-purple-500/50 transition-all duration-200"
                                                >
                                                    <div className="p-2.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 group-hover:bg-purple-200 dark:group-hover:bg-purple-900/60 transition-colors">
                                                        <K6Logo className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                                    </div>
                                                    <span className="text-xs font-medium text-foreground">Performance</span>
                                                </button>
                                            </div>
                                        </div>



                                        {/* External Link - styled like CI/CD trigger in Jobs */}
                                        {/* External Link - styled like CI/CD trigger in Jobs */}
                                        {(selectedRequirement.externalUrl || selectedRequirement.externalId) && (
                                            <div className="space-y-2 bg-card p-4 rounded-lg border border-border/40">
                                                <h3 className="text-xs font-medium text-muted-foreground">External Link</h3>
                                                <div className="flex items-center gap-3">
                                                    {selectedRequirement.externalProvider && (
                                                        <Badge variant="outline" className="font-normal">
                                                            {selectedRequirement.externalProvider}
                                                        </Badge>
                                                    )}
                                                    {selectedRequirement.externalUrl ? (
                                                        <a
                                                            href={selectedRequirement.externalUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-sm text-blue-500 hover:underline flex items-center gap-1 font-medium"
                                                        >
                                                            {selectedRequirement.externalId || "Open Link"}
                                                            <ExternalLink className="h-3 w-3" />
                                                        </a>
                                                    ) : (
                                                        <span className="text-sm font-medium">{selectedRequirement.externalId}</span>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Stats - Grid specific to Requirements */}
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40 text-center">
                                                <div className="text-2xl font-bold text-primary">
                                                    {selectedRequirement.linkedTestCount}
                                                </div>
                                                <div className="text-xs text-muted-foreground">Linked Tests</div>
                                            </div>
                                            <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40 text-center">
                                                <div className="text-2xl font-bold text-green-500">
                                                    {selectedRequirement.passedTestCount}
                                                </div>
                                                <div className="text-xs text-muted-foreground">Passed</div>
                                            </div>
                                            <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40 text-center">
                                                <div className="text-2xl font-bold text-red-500">
                                                    {selectedRequirement.failedTestCount}
                                                </div>
                                                <div className="text-xs text-muted-foreground">Failed</div>
                                            </div>
                                        </div>



                                        {/* Timestamps */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40">
                                                <h3 className="text-xs font-medium text-muted-foreground">Created</h3>
                                                <div>
                                                    <p className="text-sm">
                                                        {formatDate(selectedRequirement.createdAt)}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground flex items-center">
                                                        <CalendarIcon className="h-3 w-3 mr-1" />
                                                        {formatRelativeDate(selectedRequirement.createdAt)}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="space-y-0.5 bg-card p-4 rounded-lg border border-border/40">
                                                <h3 className="text-xs font-medium text-muted-foreground">Updated</h3>
                                                <div>
                                                    <p className="text-sm">
                                                        {selectedRequirement.updatedAt ? formatDate(selectedRequirement.updatedAt) : "Not updated"}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground flex items-center">
                                                        <ClockIcon className="h-3 w-3 mr-1" />
                                                        {selectedRequirement.updatedAt ? formatRelativeDate(selectedRequirement.updatedAt) : "NA"}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="tests" className="space-y-4 mt-0">
                                        <div className="flex items-center justify-between">

                                        </div>

                                        {testsLoading ? (
                                            <SuperCheckLoading className="py-12" />
                                        ) : linkedTests.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                                <FileText className="h-12 w-12 mb-4" />
                                                <p className="text-lg font-medium">No tests linked</p>
                                                <p className="text-sm">Link tests to this requirement to see them here.</p>
                                            </div>
                                        ) : (
                                            <RequirementTestDataTable
                                                columns={testColumns}
                                                data={linkedTests}
                                                onRowClick={(id) => window.open(`/playground/${id}`, '_blank')}
                                            />
                                        )}
                                    </TabsContent>
                                </Tabs>
                            </div>

                        </>
                    )}
                </SheetContent>
            </Sheet>

            {/* Link Tests Dialog Removed from here */}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Requirement?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete this requirement and unlink all associated tests
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDelete}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div >
    );
}
