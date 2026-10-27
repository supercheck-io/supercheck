"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { TableBadge } from "@/components/ui/table-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateCell } from "@/components/ui/table-cells";
import { TruncatedTextWithTooltip } from "@/components/ui/truncated-text-with-tooltip";

import { Edit3, FolderOpen, MapPin, MoreHorizontal, Users } from "lucide-react";
import { toast } from "sonner";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import { UUIDField } from "@/components/ui/uuid-field";
import { UserAvatar } from "@/components/ui/user-cell";

export interface ProjectMember {
  id: string;
  name: string;
  email: string;
  role: string;
  image?: string | null;
}

export interface Project {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  /** Assigned project members plus org owners/admins. */
  membersCount: number;
  members?: ProjectMember[];
  createdAt: string;
  isDefault: boolean;
}

export function createProjectColumns(
  onEditProject?: (project: Project) => void,
  canManageProject?: boolean,
  onManageLocations?: (project: Project) => void
): ColumnDef<Project>[] {
  return [
    {
      accessorKey: "id",
      header: ({ column }) => (
        <DataTableColumnHeader
          className="pl-1"
          column={column}
          title="Project ID"
        />
      ),
      cell: ({ row }) => {
        const id = row.getValue("id") as string;
        return (
          <div className="flex items-center h-8">
            <UUIDField
              value={id}
              maxLength={8}
              onCopy={() => toast.success("Project ID copied to clipboard")}
            />
          </div>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Project" />
      ),
      cell: ({ row }) => {
        const project = row.original;

        return (
          <div className="flex h-8 min-w-[200px] items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/10">
              <FolderOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="truncate text-sm font-medium text-foreground">
              {project.name}
            </span>
            {project.isDefault && <TableBadge compact>Default</TableBadge>}
          </div>
        );
      },
      filterFn: (row, id, value) => {
        const project = row.getValue(id) as string;
        const description = row.original.description || "";
        const searchText = `${project} ${description}`;
        return searchText.toLowerCase().includes(value.toLowerCase());
      },
    },
    {
      accessorKey: "description",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Description" />
      ),
      cell: ({ row }) =>
        row.original.description ? (
          <TruncatedTextWithTooltip
            text={row.original.description}
            maxLength={40}
            maxWidth="260px"
            className="text-sm text-muted-foreground"
          />
        ) : (
          <span className="text-sm text-muted-foreground">No description</span>
        ),
    },
    {
      accessorKey: "membersCount",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Members" />
      ),
      cell: ({ row }) => {
        const project = row.original;
        const count = project.membersCount;
        const members = project.members || [];

        // Show up to 3 member avatars, then +X more
        const displayMembers = members.slice(0, 3);
        const remainingCount = Math.max(0, count - displayMembers.length);

        return (
          <div className="flex items-center h-8 gap-2" title="Assigned members plus organization owners and admins">
            <div className="flex items-center">
              {displayMembers.length > 0 ? (
                <>
                  <div className="flex -space-x-2">
                    {displayMembers.map((member, index) => (
                      <span
                        key={member.id}
                        title={member.name}
                        style={{ zIndex: displayMembers.length - index }}
                      >
                        <UserAvatar name={member.name} image={member.image} className="border-2 border-background" />
                      </span>
                    ))}
                    {remainingCount > 0 && (
                      <div
                        className="w-6 h-6 rounded-full bg-gray-100 border-2 border-background flex items-center justify-center text-xs font-medium text-gray-600"
                        title={`+${remainingCount} more member${remainingCount > 1 ? "s" : ""}`}
                      >
                        +{remainingCount}
                      </div>
                    )}
                  </div>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {count.toLocaleString("en-US")} member{count !== 1 ? "s" : ""}
                  </span>
                </>
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="ml-1 text-sm text-muted-foreground">
                    {count.toLocaleString("en-US")} member{count !== 1 ? "s" : ""}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Created" />
      ),
      cell: ({ row }) => <DateCell value={row.original.createdAt} />,
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const project = row.original;

        if (!canManageProject) {
          return (
            <span className="text-xs text-muted-foreground">View only</span>
          );
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Open actions for ${project.name}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEditProject?.(project)}>
                <Edit3 className="mr-2 h-3.5 w-3.5" />
                Edit project
              </DropdownMenuItem>
              {onManageLocations && (
                <DropdownMenuItem onClick={() => onManageLocations(project)}>
                  <MapPin className="mr-2 h-3.5 w-3.5" />
                  Location restrictions
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
