import type { Row } from "@tanstack/react-table";
import { MoreHorizontal, PencilIcon, TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { toast } from "sonner";
import { deleteTest } from "@/actions/delete-test";
import { useTestPermissions } from "@/hooks/use-rbac-permissions";

import { testSchema } from "./schema";

interface DataTableRowActionsProps<TData> {
  row: Row<TData>;
  onDelete?: () => void;
}

export function DataTableRowActions<TData>({
  row,
  onDelete,
}: DataTableRowActionsProps<TData>) {
  const router = useRouter();
  const { canEditTest, canDeleteTest } = useTestPermissions();
  
  // Use safeParse instead of parse to handle validation errors
  const parsedTest = testSchema.safeParse(row.original);
  
  // If parsing fails, provide default values to prevent errors
  const test = parsedTest.success 
    ? parsedTest.data 
    : {
        id: (row.original as unknown as { id?: string })?.id || "",
        title: (row.original as unknown as { title?: string })?.title || "Untitled Test",
        description: (row.original as unknown as { description?: string | null })?.description || null,
        priority: "medium",
        type: "browser",
      };
      
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleEditTest = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click event
    router.push(`/playground/${test.id}`);
  };

  const handleDeleteTest = async () => {
    if (!test.id) return;

    setIsDeleting(true);

    // Show a loading toast for delete operation
    const deleteToastId = toast.loading("Deleting test...", {
      description: "Please wait while we delete the test.",
      duration: Infinity, // Keep loading until dismissed
    });

    try {
      // Use the server action to delete the test
      const result = await deleteTest(test.id);

      if (!result.success) {
        // Check for specific error codes
        if (result.errorCode === 409) {
          toast.error("Cannot Delete Test", {
            description:
              result.error || "This test is currently used in one or more jobs or synthetic monitors.",
            duration: 5000, // Show for longer
            id: deleteToastId, // Update the loading toast
          });
          return;
        } else {
          throw new Error(result.error || "Failed to delete test");
        }
      }

      toast.success("Test deleted successfully", {
        description: `Test \"${test.title}\" has been permanently removed.`,
        id: deleteToastId, // Update the loading toast
        duration: 5000, // Add auto-dismiss after 5 seconds
      });

      // Call onDelete callback if provided
      if (onDelete) {
        onDelete();
      }

      // Refresh the page to update the test list
      router.refresh();
    } catch (error) {
      console.error("Error deleting test:", error);
      toast.error("Error deleting test", {
        description:
          error instanceof Error ? error.message : "Failed to delete test",
        id: deleteToastId, // Update the loading toast
        duration: 5000, // Add auto-dismiss after 5 seconds
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <TooltipProvider>
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
        <DropdownMenuContent align="end" className="w-[160px]">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem
                  onClick={canEditTest ? handleEditTest : undefined}
                  disabled={!canEditTest}
                  className={!canEditTest ? "opacity-50 cursor-not-allowed" : ""}
                >
                  <PencilIcon className="mr-2 h-4 w-4" />
                  <span>Edit</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            {!canEditTest && (
              <TooltipContent>
                <p>Insufficient permissions to edit tests</p>
              </TooltipContent>
            )}
          </Tooltip>

          <DropdownMenuSeparator />

          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem
                  onClick={canDeleteTest ? (e) => {
                    e.stopPropagation();
                    setShowDeleteDialog(true);
                  } : undefined}
                  disabled={!canDeleteTest}
                  className={`${!canDeleteTest ? "opacity-50 cursor-not-allowed" : "text-red-600"}`}
                >
                  <TrashIcon className="mr-2 h-4 w-4" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            {!canDeleteTest && (
              <TooltipContent>
                <p>Insufficient permissions to delete tests</p>
              </TooltipContent>
            )}
          </Tooltip>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Test</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the test <span className="font-semibold">&quot;{test.title}&quot;</span>. This action cannot be undone.
              <br /><br />
              <strong>Note:</strong> If this test is currently used in any jobs or synthetic monitors, the deletion will be prevented and you&apos;ll need to remove the test from those jobs or delete the monitors first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteTest();
              }}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
