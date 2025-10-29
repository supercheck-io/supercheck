"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
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
  MoreHorizontal, 
  Edit, 
  Trash2,
  Eye,
  EyeOff,
  CalendarIcon,
  ClockIcon
} from "lucide-react";
import { Variable } from "./schema";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { useState } from "react";
import { toast } from "sonner";
import { VariableDialog } from "./variable-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Component for value with popover on truncation
function ValueWithPopover({ value, isSecret, isVisible, decryptedValue }: { value?: string; isSecret: boolean; isVisible: boolean; decryptedValue?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  // Handle undefined or null values
  const safeValue = value || "";
  // Use decryptedValue when visible and available, otherwise show masked or plain value
  const displayValue = isSecret && isVisible && decryptedValue
    ? decryptedValue
    : (isSecret && !isVisible ? '*'.repeat(Math.min(safeValue.length || 12, 16)) : safeValue);
  const isTruncated = (displayValue || "").length > 25;

  if (!isTruncated) {
    return (
      <code className="font-mono text-xs bg-muted px-2 py-1 rounded">
        {displayValue}
      </code>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <code
          className="font-mono text-xs bg-muted px-2 py-1 rounded cursor-pointer max-w-[200px] truncate inline-block"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          {displayValue}
        </code>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[400px]">
        <code className="text-xs font-mono whitespace-pre-wrap break-all">
          {displayValue}
        </code>
      </PopoverContent>
    </Popover>
  );
}

// Component for description with popover on truncation
function DescriptionWithPopover({ description }: { description: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const displayText = description || "No description";
  const isTruncated = displayText.length > 30;

  if (!isTruncated) {
    return (
      <span className="text-sm text-muted-foreground">
        {displayText}
      </span>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <span
          className="text-sm text-muted-foreground cursor-pointer max-w-[200px] truncate inline-block"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          {displayText}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[400px]">
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {displayText}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export const columns: ColumnDef<Variable>[] = [
  {
    accessorKey: "key",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),
    cell: ({ row }) => {
      const key = row.getValue("key") as string;
      return (
        <div className="relative inline-flex items-center">
          <code className="font-mono font-semibold text-xs bg-muted px-2 py-1 rounded">
            {key}
          </code>
          <CopyButton 
            value={key} 
            onCopy={() => toast.success("Variable name copied to clipboard")} 
            className="ml-1 opacity-100"
          />
        </div>
      );
    },
  },
  {
    accessorKey: "isSecret",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Type" />
    ),
    cell: ({ row }) => {
      const isSecret = row.getValue("isSecret") as string;
      const isSecretBool = isSecret === "true";
      return (
        <div className="flex items-center w-[120px]">
          <Badge 
            variant={isSecretBool ? "outline" : "secondary"} 
            className={`text-xs ${isSecretBool ? "border-red-300 text-red-600 bg-red-100 dark:border-red-400 dark:text-red-400 dark:bg-red-900/20" : "dark:bg-gray-600 dark:text-gray-200"}`}
          >
            {isSecretBool ? "Secret" : "Variable"}
          </Badge>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const isSecret = row.getValue(id) as string;
      return value.includes(isSecret);
    },
  },
  {
    accessorKey: "value",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Value" />
    ),
    cell: ({ row, table }) => {
      const isSecret = row.getValue("isSecret") as string;
      const isSecretBool = isSecret === "true";
      const value = row.getValue("value") as string;
      const variable = row.original;
      const meta = table.options.meta as {
        secretVisibility?: { [key: string]: boolean };
        decryptedValues?: { [key: string]: string };
      };
      const isVisible = meta?.secretVisibility?.[variable.id] || false;
      const decryptedValue = meta?.decryptedValues?.[variable.id];

      return (
        <ValueWithPopover
          value={value}
          isSecret={isSecretBool}
          isVisible={isVisible}
          decryptedValue={decryptedValue}
        />
      );
    },
  },
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
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Created" />
    ),
    cell: ({ row }) => {
      const createdAt = row.getValue("createdAt") as string;
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
  {
    accessorKey: "updatedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Updated" />
    ),
    cell: ({ row }) => {
      const updatedAt = row.getValue("updatedAt") as string;
      const createdAt = row.getValue("createdAt") as string;
      
      // Check if updatedAt is the same as createdAt (never updated)
      if (!updatedAt || updatedAt === createdAt) {
        return (
          <div className="flex items-center w-[170px]">
            <ClockIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground text-sm">Not updated</span>
          </div>
        );
      }

      const date = new Date(updatedAt);
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
          <ClockIcon className="mr-2 h-4 w-4 text-muted-foreground" />
          <span>{formattedDate}</span>
          <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const variable = row.original;
      const meta = table.options.meta as {
        canManage?: boolean;
        canCreateEdit?: boolean;
        canDelete?: boolean;
        canViewSecrets?: boolean;
        onDeleteVariable?: (id: string) => void;
        onEditVariable?: (variable: Variable) => void;
        secretVisibility?: { [key: string]: boolean };
        onToggleSecretVisibility?: (id: string) => void;
        projectId?: string;
        onSuccess?: () => void;
        editDialogState?: { [key: string]: boolean };
        setEditDialogState?: (id: string, open: boolean) => void;
      };
      const canManage = meta?.canManage || false;
      const canCreateEdit = meta?.canCreateEdit || false;
      const canDelete = meta?.canDelete || false;
      const canViewSecrets = meta?.canViewSecrets || false;
      const isSecret = row.getValue("isSecret") as string;
      const isSecretBool = isSecret === "true";
      const editDialogOpen = meta?.editDialogState?.[variable.id] || false;

      // Always show actions dropdown, but disable items based on permissions

      const handleDelete = async () => {
        try {
          // Use project ID from meta (passed from parent component)
          const projectId = meta?.projectId;

          if (!projectId) {
            toast.error("Project context not available. Please refresh the page.");
            return;
          }

          const response = await fetch(`/api/projects/${projectId}/variables/${variable.id}`, {
            method: 'DELETE',
          });

          const data = await response.json();

          if (response.ok && data.success) {
            toast.success("Variable deleted successfully");
            meta?.onDeleteVariable?.(variable.id);
          } else {
            toast.error(data.error || "Failed to delete variable");
          }
        } catch (error) {
          console.error("Error deleting variable:", error);
          toast.error("Failed to delete variable. Please try again.");
        }
      };

      return (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isSecretBool && (
                <DropdownMenuItem
                  onClick={canViewSecrets ? () => meta?.onToggleSecretVisibility?.(variable.id) : undefined}
                  disabled={!canViewSecrets}
                  className={!canViewSecrets ? "opacity-50 cursor-not-allowed" : ""}
                >
                  {meta?.secretVisibility?.[variable.id] ? (
                    <>
                      <EyeOff className="mr-2 h-4 w-4" />
                      Hide Value
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 h-4 w-4" />
                      Show Value
                    </>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(canManage || canCreateEdit) ? () => meta?.setEditDialogState?.(variable.id, true) : undefined}
                disabled={!(canManage || canCreateEdit)}
                className={!(canManage || canCreateEdit) ? "opacity-50 cursor-not-allowed" : ""}
              >
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    onSelect={(e) => !(canManage || canDelete) ? e.preventDefault() : e.preventDefault()}
                    disabled={!(canManage || canDelete)}
                    className={`text-destructive ${!(canManage || canDelete) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                {(canManage || canDelete) && (
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Variable</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete the variable <strong>{variable.key}</strong>? 
                        This action cannot be undone and may affect any tests or jobs that use this variable.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete Variable
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                )}
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
          {meta?.projectId && (
            <VariableDialog
              open={editDialogOpen}
              onOpenChange={(open) => meta?.setEditDialogState?.(variable.id, open)}
              projectId={meta.projectId}
              variable={variable}
              onSuccess={() => {
                meta.onSuccess?.();
                meta?.setEditDialogState?.(variable.id, false);
              }}
            />
          )}
        </>
      );
    },
  },
];