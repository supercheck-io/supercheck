"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Edit3, FolderOpen, Users, Calendar } from "lucide-react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";

export interface ProjectMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'archived' | 'deleted';
  membersCount: number;
  members?: ProjectMember[];
  createdAt: string;
  isDefault: boolean;
}

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'archived':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'deleted':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const formattedDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const formattedTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { formattedDate, formattedTime };
};

export function createProjectColumns(
  onEditProject?: (project: Project) => void,
  canManageProject?: boolean
): ColumnDef<Project>[] {
  return [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Project" />
      ),
      cell: ({ row }) => {
        const project = row.original;
        
        return (
          <div className="py-1 min-w-[200px] flex items-center">
            <div className="flex items-center gap-2.5">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FolderOpen className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground flex items-center gap-2">
                  <span className="truncate">{project.name}</span>
                  {project.isDefault && (
                    <Badge variant="secondary" className="text-xs px-2 py-0.5">
                      Default
                    </Badge>
                  )}
                </div>
                {project.description && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {project.description}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      },
      filterFn: (row, id, value) => {
        const project = row.getValue(id) as string;
        const description = row.original.description || '';
        const searchText = `${project} ${description}`;
        return searchText.toLowerCase().includes(value.toLowerCase());
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        
        return (
          <div className="py-1 flex items-center">
            <Badge 
              variant="outline" 
              className={`${getStatusBadgeColor(status)} text-xs px-3 py-1.5 font-medium capitalize`}
            >
              {status}
            </Badge>
          </div>
        );
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
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
          <div className="py-1 flex items-center gap-2">
            <div className="flex items-center">
              {displayMembers.length > 0 ? (
                <>
                  <div className="flex -space-x-2">
                    {displayMembers.map((member, index) => (
                      <div
                        key={member.id}
                        className="w-6 h-6 rounded-full bg-blue-100 border-2 border-background flex items-center justify-center text-xs font-medium text-blue-600"
                        title={`${member.name} (${member.role})`}
                        style={{ zIndex: displayMembers.length - index }}
                      >
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {remainingCount > 0 && (
                      <div
                        className="w-6 h-6 rounded-full bg-gray-100 border-2 border-background flex items-center justify-center text-xs font-medium text-gray-600"
                        title={`+${remainingCount} more member${remainingCount > 1 ? 's' : ''}`}
                      >
                        +{remainingCount}
                      </div>
                    )}
                  </div>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {count} member{count !== 1 ? 's' : ''}
                  </span>
                </>
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {count} member{count !== 1 ? 's' : ''}
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
      cell: ({ row }) => {
        const { formattedDate, formattedTime } = formatDate(row.getValue("createdAt"));
        
        return (
          <div className="py-1 flex items-center text-sm">
            <Calendar className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <span>{formattedDate}</span>
            <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const project = row.original;
        
        if (!canManageProject) {
          return (
            <div className="py-1">
              <span className="text-xs text-muted-foreground">View only</span>
            </div>
          );
        }
        
        return (
          <div className="py-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-700 border-gray-200 hover:border-gray-300 transition-all duration-200 rounded-md shadow-sm"
              onClick={() => {
                if (onEditProject) {
                  onEditProject(project);
                }
              }}
            >
              <Edit3 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];
}