"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { MoreHorizontal, ExternalLink, Trash2, Pencil, CalendarIcon, CheckCircle, XCircle, CircleDashed } from "lucide-react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import { UUIDField } from "@/components/ui/uuid-field";
import { toast } from "sonner";
import { useState } from "react";
import { Requirement, coverageStatusConfig } from "./schema";
import { priorities } from "./data";

// Meta type for row actions (passed from parent)
export interface RequirementsTableMeta {
    onDeleteRequirement?: (id: string) => void;
    onEditRequirement?: (id: string) => void;
    canEdit?: boolean;
    canDelete?: boolean;
}

// Title with popover (matching tests pattern)
function TitleWithPopover({ title }: { title: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const isTruncated = title.length > 25;

    if (!isTruncated) {
        return (
            <div className="flex space-x-2">
                <span className="font-medium max-w-[160px] truncate">{title}</span>
            </div>
        );
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <div
                    className="flex space-x-2 cursor-pointer"
                    onMouseEnter={() => setIsOpen(true)}
                    onMouseLeave={() => setIsOpen(false)}
                >
                    <span className="max-w-[160px] truncate">{title}</span>
                </div>
            </PopoverTrigger>
            <PopoverContent className="flex justify-center items-center w-auto max-w-[500px]">
                <p className="text-xs text-muted-foreground">{title}</p>
            </PopoverContent>
        </Popover>
    );
}

// Description with popover (matching tests pattern)
function DescriptionWithPopover({ description }: { description: string | null }) {
    const [isOpen, setIsOpen] = useState(false);
    const displayText = description || "No description provided";
    const isTruncated = displayText.length > 25;

    if (!isTruncated) {
        return <div className="max-w-[200px] truncate">{displayText}</div>;
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <div
                    className="max-w-[160px] truncate cursor-pointer"
                    onMouseEnter={() => setIsOpen(true)}
                    onMouseLeave={() => setIsOpen(false)}
                >
                    {displayText}
                </div>
            </PopoverTrigger>
            <PopoverContent className="flex justify-center items-center w-auto max-w-[500px]">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{displayText}</p>
            </PopoverContent>
        </Popover>
    );
}

// Predefined colors for common requirement tags
// These provide consistent coloring for AI-extracted and commonly used tags
const TAG_COLORS: Record<string, string> = {
    // AI & Generation
    ai: "#a855f7",           // purple-500 - AI generated content

    // Test Categories (Functional)
    api: "#14b8a6",          // teal-500 - API tests
    ui: "#3b82f6",           // blue-500 - UI/Frontend tests
    auth: "#f59e0b",         // amber-500 - Authentication/Authorization
    data: "#22c55e",         // green-500 - Data/Database operations
    integration: "#ec4899",  // pink-500 - Integration tests
    validation: "#06b6d4",   // cyan-500 - Input/Form validation

    // Test Categories (Non-Functional)
    performance: "#8b5cf6",  // violet-500 - Performance/Load tests
    security: "#ef4444",     // red-500 - Security tests
    accessibility: "#6366f1", // indigo-500 - Accessibility (a11y)

    // Test Types
    e2e: "#0ea5e9",          // sky-500 - End-to-end tests
    unit: "#84cc16",         // lime-500 - Unit tests
    smoke: "#f97316",        // orange-500 - Smoke tests
    regression: "#64748b",   // slate-500 - Regression tests

    // Priority/Importance
    critical: "#dc2626",     // red-600 - Critical path
    "edge-case": "#a3a3a3",  // neutral-400 - Edge cases

    // Categories
    crud: "#10b981",         // emerald-500 - CRUD operations
    workflow: "#8b5cf6",     // violet-500 - Business workflows
    error: "#f43f5e",        // rose-500 - Error handling
    negative: "#fb923c",     // orange-400 - Negative test cases

    // Common feature areas
    search: "#2dd4bf",       // teal-400 - Search functionality
    upload: "#34d399",       // emerald-400 - File upload
    payment: "#fbbf24",      // amber-400 - Payment/Billing
    notification: "#a78bfa", // violet-400 - Notifications
    report: "#60a5fa",       // blue-400 - Reports/Analytics
};

/**
 * Get color for a tag - DB color takes priority, then predefined, then null
 */
function getTagColor(tag: { name: string; color: string | null }): string | null {
    if (tag.color) return tag.color;
    return TAG_COLORS[tag.name.toLowerCase()] || null;
}
function TagsCell({ tags }: { tags: Array<{ id: string; name: string; color: string | null }> }) {
    const [isOpen, setIsOpen] = useState(false);

    if (!tags || tags.length === 0) {
        return <div className="text-muted-foreground text-sm">No tags</div>;
    }

    const displayTags = tags.slice(0, 2);
    const remainingCount = tags.length - 2;

    if (tags.length <= 2) {
        return (
            <div className="flex items-center gap-1 min-h-[24px]">
                {tags.map((tag) => (
                    <Badge
                        key={tag.id}
                        variant="secondary"
                        className="text-xs whitespace-nowrap flex-shrink-0"
                        style={(() => { const color = getTagColor(tag); return color ? { backgroundColor: color + "20", color: color } : {}; })()}
                    >
                        {tag.name}
                    </Badge>
                ))}
            </div>
        );
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <div
                    className="flex items-center gap-1 min-h-[24px] cursor-pointer"
                    onMouseEnter={() => setIsOpen(true)}
                    onMouseLeave={() => setIsOpen(false)}
                >
                    {displayTags.map((tag) => (
                        <Badge
                            key={tag.id}
                            variant="secondary"
                            className="text-xs whitespace-nowrap flex-shrink-0"
                            style={(() => { const color = getTagColor(tag); return color ? { backgroundColor: color + "20", color: color } : {}; })()}
                        >
                            {tag.name}
                        </Badge>
                    ))}
                    {remainingCount > 0 && (
                        <Badge variant="secondary" className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                            +{remainingCount}
                        </Badge>
                    )}
                </div>
            </PopoverTrigger>
            <PopoverContent className="flex justify-center items-center w-auto max-w-[500px]">
                <div className="flex justify-center flex-wrap gap-1">
                    {tags.map((tag) => (
                        <Badge
                            key={tag.id}
                            variant="secondary"
                            className="text-xs"
                            style={(() => { const color = getTagColor(tag); return color ? { backgroundColor: color + "20", color: color } : {}; })()}
                        >
                            {tag.name}
                        </Badge>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export const columns: ColumnDef<Requirement>[] = [
    // ID column (first, matching tests)
    {
        accessorKey: "id",
        header: ({ column }) => (
            <DataTableColumnHeader className="ml-2" column={column} title="Req ID" />
        ),
        cell: ({ row }) => {
            const id = row.getValue("id") as string;
            return (
                <div className="w-[90px]">
                    <UUIDField
                        value={id}
                        maxLength={8}
                        onCopy={() => toast.success("Requirement ID copied to clipboard")}
                    />
                </div>
            );
        },
        enableSorting: false,
        enableHiding: false,
    },

    // Title column
    {
        accessorKey: "title",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Title" />
        ),
        cell: ({ row }) => {
            const title = row.getValue("title") as string;
            return <TitleWithPopover title={title} />;
        },
        enableGlobalFilter: true,
    },

    // Description column (matching tests)
    {
        accessorKey: "description",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Description" />
        ),
        cell: ({ row }) => {
            const description = row.getValue("description") as string | null;
            return <DescriptionWithPopover description={description} />;
        },
    },

    // Coverage Status column
    {
        accessorKey: "coverageStatus",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
            const status = row.getValue("coverageStatus") as keyof typeof coverageStatusConfig;
            const config = coverageStatusConfig[status] || coverageStatusConfig.missing;
            const linkedCount = row.original.linkedTestCount;

            const StatusIcon = {
                covered: CheckCircle,
                failing: XCircle,
                missing: CircleDashed,
            }[status] || CircleDashed;

            return (
                <div className="flex items-center w-[120px]">
                    <StatusIcon className={`h-4 w-4 mr-2 ${config.color}`} />
                    <span>{config.label}</span>
                    {linkedCount > 0 && (
                        <Badge variant="secondary" className="ml-2 text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {linkedCount}
                        </Badge>
                    )}
                </div>
            );
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id));
        },
    },

    // Priority column (matching tests exactly)
    {
        accessorKey: "priority",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Priority" />
        ),
        cell: ({ row }) => {
            const priority = priorities.find(
                (p) => p.value === row.getValue("priority")
            );

            if (!priority) {
                return null;
            }

            return (
                <div className="flex items-center w-[100px]">
                    {priority.icon && (
                        <priority.icon className={`mr-2 h-4 w-4 ${priority.color}`} />
                    )}
                    <span>{priority.label}</span>
                </div>
            );
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id));
        },
    },

    // Tags column (matching tests)
    {
        accessorKey: "tags",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Tags" />
        ),
        cell: ({ row }) => {
            const tags = row.getValue("tags") as Array<{ id: string; name: string; color: string | null }>;
            return <TagsCell tags={tags} />;
        },
        filterFn: (row, id, value: string[]) => {
            const tags = row.getValue(id) as Array<{ id: string; name: string; color: string | null }>;
            if (!tags || tags.length === 0) return false;
            return value.some((filterTag) =>
                tags.some((tag) => tag.name.toLowerCase().includes(filterTag.toLowerCase()))
            );
        },
    },

    // External Link column
    {
        accessorKey: "externalId",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="External" />
        ),
        cell: ({ row }) => {
            const externalId = row.original.externalId;
            const externalUrl = row.original.externalUrl;
            const provider = row.original.externalProvider;

            if (!externalId && !externalUrl) {
                return <span className="text-muted-foreground">None</span>;
            }

            return (
                <a
                    href={externalUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={provider ? `Open in ${provider}` : "Open external link"}
                >
                    <Badge variant="outline" className="flex items-center gap-1.5 hover:bg-muted cursor-pointer font-normal text-xs py-0.5 h-6">
                        <ExternalLink className="h-3 w-3" />
                        <span>{provider || "External Link"}</span>
                    </Badge>
                </a>
            );
        },
        enableSorting: true,
    },

    // Created column (matching tests with CalendarIcon)
    {
        accessorKey: "createdAt",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => {
            const createdAt = row.getValue("createdAt") as Date | string | null;
            if (!createdAt) return null;

            const date = new Date(createdAt);
            const formattedDate = date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
            });
            const formattedTime = date.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
            });

            return (
                <div className="flex items-center w-[170px]">
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>{formattedDate}</span>
                    <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
                </div>
            );
        },
    },

    // Actions column
    {
        id: "actions",
        cell: ({ row, table }) => {
            const requirement = row.original;
            const meta = table.options.meta as RequirementsTableMeta | undefined;
            const canEdit = meta?.canEdit !== false;
            const canDelete = meta?.canDelete !== false;

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" className="h-8 w-8 p-0 data-[state=open]:bg-muted">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[160px]">
                        <DropdownMenuItem
                            onClick={(e) => {
                                e.stopPropagation();
                                meta?.onEditRequirement?.(requirement.id);
                            }}
                            disabled={!canEdit}
                        >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-red-600"
                            onClick={(e) => {
                                e.stopPropagation();
                                meta?.onDeleteRequirement?.(requirement.id);
                            }}
                            disabled={!canDelete}
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            );
        },
    },
];
