"use client";

import type { Row } from "@tanstack/react-table";
import { MoreHorizontal, Trash2, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useState } from "react";
import { deleteRun } from "@/actions/delete-run";

import { TestRun } from "./schema";

interface DataTableRowActionsProps<TData> {
  row: Row<TData>;
  onDelete?: () => void;
  canDelete?: boolean;
}

export function DataTableRowActions<TData>({
  row,
  onDelete,
  canDelete = true, // Default to true for backward compatibility
}: DataTableRowActionsProps<TData>) {
  const router = useRouter();
  const run = row.original as unknown as TestRun;
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleViewRun = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click event
    router.push(`/runs/${run.id}`);
  };

  const handleDeleteRun = async () => {
    if (!run.id) return;

    setIsDeleting(true);

    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(new Error("Delete operation timed out after 30 seconds")),
          30000
        );
      });

      const result = (await Promise.race([
        deleteRun(run.id),
        timeoutPromise,
      ])) as Awaited<ReturnType<typeof deleteRun>>;

      if (!result.success) {
        // If error is "Run not found", run may have been deleted already
        if (
          result.error === "Run not found" ||
          result.error === "Run not found or access denied"
        ) {
          // Show a warning instead of an error
          toast.warning("Run already deleted", {
            description: "This run was already deleted or doesn't exist.",
          });

          // Call the onDelete callback to refresh data
          if (onDelete) {
            onDelete();
          }
          // Don't return early - let the finally block execute
        } else {
          // For other errors, throw the error to be caught below
          throw new Error(result.error || "Failed to delete run");
        }
      } else {
        toast.success("Run deleted successfully");

        // Call onDelete callback if provided to refresh data
        if (onDelete) {
          onDelete();
        }
      }
    } catch (error) {
      console.error("[DELETE_RUN_UI] Error deleting run:", error);
      console.error("[DELETE_RUN_UI] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : "No stack available",
      });
      toast.error("Error deleting run", {
        description:
          error instanceof Error ? error.message : "Failed to delete run",
        duration: 5000, // Add auto-dismiss after 5 seconds
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem onClick={handleViewRun}>
            <ExternalLink className="mr-2 h-4 w-4" />
            <span>View Run</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              if (canDelete) {
                setShowDeleteDialog(true);
              }
            }}
            disabled={!canDelete}
            className={canDelete ? "text-red-600" : "text-muted-foreground"}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Run</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this run. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteRun();
              }}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
