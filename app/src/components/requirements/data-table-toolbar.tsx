import type { Table } from "@tanstack/react-table";
import { PlusIcon, X, Search, Upload, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { priorities, coverageStatuses } from "./data";
import { DataTableFacetedFilter } from "@/components/tests/data-table-faceted-filter";
import { DataTableTagFilter } from "@/components/tests/data-table-tag-filter";
import { DataTableViewOptions } from "@/components/tests/data-table-view-options";
import { UploadDocumentDialog } from "./upload-document-dialog";
import { exportRequirementsCsv } from "@/actions/requirements";

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    canCreateRequirement?: boolean;
}

export function DataTableToolbar<TData>({
    table,
    canCreateRequirement = false,
}: DataTableToolbarProps<TData>) {
    const router = useRouter();
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const result = await exportRequirementsCsv();
            if (result.success && result.csv && result.filename) {
                // Create blob and trigger download
                const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = result.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                toast.success("Requirements exported successfully");
            } else {
                toast.error(result.error || "Failed to export requirements");
            }
        } catch (error) {
            console.error("Export error:", error);
            toast.error("Failed to export requirements");
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center justify-between space-y-2">
                    <div className="flex flex-col">
                        <h2 className="text-2xl font-semibold">Requirements</h2>
                        <p className="text-muted-foreground text-sm">
                            Manage requirements and their test coverage
                        </p>
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    <div className="relative">
                        <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Filter by all available fields..."
                            value={(table.getState().globalFilter as string) ?? ""}
                            onChange={(event) => table.setGlobalFilter(event.target.value)}
                            className="h-8 w-[250px] pr-8 pl-8"
                            data-testid="search-input"
                        />
                        {(table.getState().globalFilter as string)?.length > 0 && (
                            <button
                                type="reset"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-red-500 rounded-sm bg-red-200 p-0.5"
                                onClick={() => table.setGlobalFilter("")}
                                tabIndex={0}
                                aria-label="Clear search"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    {table.getColumn("priority") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("priority")}
                            title="Priority"
                            options={priorities}
                        />
                    )}
                    {table.getColumn("coverageStatus") && (
                        <DataTableFacetedFilter
                            column={table.getColumn("coverageStatus")}
                            title="Status"
                            options={coverageStatuses}
                        />
                    )}
                    {table.getColumn("tags") && (
                        <DataTableTagFilter
                            column={table.getColumn("tags")}
                            title="Tags"
                        />
                    )}
                    <DataTableViewOptions table={table} />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        disabled={isExporting}
                        data-testid="export-requirements-button"
                    >
                        {isExporting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Download className="h-4 w-4 " />
                        )}

                    </Button>
                    <Button
                        variant="secondary"
                        className="border shadow-sm"
                        onClick={() => setUploadDialogOpen(true)}
                        disabled={!canCreateRequirement}
                        data-testid="upload-document-button"
                    >
                        <Upload className="h-4 w-4" />

                    </Button>
                    <Button
                        onClick={() => router.push("/requirements/new")}
                        disabled={!canCreateRequirement}
                        data-testid="create-requirement-button"
                    >
                        <PlusIcon className="h-4 w-4 mr-2" />
                        Create Requirement
                    </Button>
                </div>
            </div>

            <UploadDocumentDialog
                open={uploadDialogOpen}
                onOpenChange={setUploadDialogOpen}
            />
        </>
    );
}

