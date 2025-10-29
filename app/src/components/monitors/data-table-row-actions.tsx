import type { Row } from "@tanstack/react-table";
import { MoreHorizontal, PencilIcon, TrashIcon, PlayIcon, PauseIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deleteMonitor } from "@/actions/delete-monitor";
import { useProjectContext } from "@/hooks/use-project-context";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { canEditMonitors, canDeleteMonitors } from "@/lib/rbac/client-permissions";

import { monitorSchema } from "./schema";

interface DataTableRowActionsProps<TData> {
  row: Row<TData>;
  onDelete?: () => void;
}

export function DataTableRowActions<TData>({
  row,
  onDelete,
}: DataTableRowActionsProps<TData>) {
  const router = useRouter();
  const { currentProject } = useProjectContext();

  // Check permissions using project context (same as jobs/tests approach)
  const userRole = currentProject?.userRole ? normalizeRole(currentProject.userRole) : null;
  const hasEditPermission = userRole ? canEditMonitors(userRole) : false;
  const hasDeletePermission = userRole ? canDeleteMonitors(userRole) : false;
  
  // Use safeParse instead of parse to handle validation errors
  const parsedMonitor = monitorSchema.safeParse(row.original);
  
  // If parsing fails, provide default values to prevent errors
  const monitor = parsedMonitor.success 
    ? parsedMonitor.data 
    : {
        id: (row.original as unknown as { id?: string })?.id || "",
        name: (row.original as unknown as { name?: string })?.name || "Untitled Monitor",
        url: (row.original as unknown as { url?: string })?.url || "",
        method: "ping" as const, 
        status: (row.original as unknown as { status?: string })?.status || "up",
      };
      
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);

  const handleEditMonitor = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click event
    router.push(`/monitors/${monitor.id}/edit`);
  };

  const handleTogglePauseResume = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click event
    if (!monitor.id) return;

    setIsPauseResumeLoading(true);
    const newStatus = monitor.status === 'paused' ? 'up' : 'paused';
    const action = monitor.status === 'paused' ? 'resume' : 'pause';

    try {
      // Call the API to toggle monitor status
      const response = await fetch(`/api/monitors/${monitor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${action} monitor`);
      }

      toast.success(`Monitor ${action}d`, {
        description: `${monitor.name} has been ${action}d.`,
      });

      // Refresh the page to update the list
      router.refresh();
    } catch (error) {
      console.error(`Error ${action}ing monitor:`, error);
      toast.error(`Error ${action}ing monitor`, {
        description: error instanceof Error ? error.message : `Failed to ${action} monitor`,
      });
    } finally {
      setIsPauseResumeLoading(false);
    }
  };

  const handleDeleteMonitor = async () => {
    if (!monitor.id) return;

    setIsDeleting(true);

    // Show a loading toast for delete operation
    const deleteToastId = toast.loading("Deleting monitor...", {
      description: "Please wait while we delete the monitor.",
      duration: Infinity, // Keep loading until dismissed
    });

    try {
      // Use the server action to delete the monitor
      const result = await deleteMonitor(monitor.id);

      if (!result?.success) {
        throw new Error(result?.error || "Failed to delete monitor");
      }

      toast.success(`Monitor "${monitor.name}" deleted successfully.`, {
        id: deleteToastId, // Update the loading toast
        duration: 5000, // Add auto-dismiss after 5 seconds
      });

      // Call onDelete callback if provided
      if (onDelete) {
        onDelete();
      }

      // Refresh the page to update the list
      router.refresh();
    } catch (error) {
      console.error("Error deleting monitor:", error);
      toast.error("Error deleting monitor", {
        description:
          error instanceof Error ? error.message : "Failed to delete monitor",
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
                  onClick={hasEditPermission ? handleEditMonitor : undefined}
                  disabled={!hasEditPermission}
                  className={!hasEditPermission ? "opacity-50 cursor-not-allowed" : ""}
                >
                  <PencilIcon className="mr-2 h-4 w-4" />
                  <span>Edit</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            {!hasEditPermission && (
              <TooltipContent>
                <p>Insufficient permissions to edit monitors</p>
              </TooltipContent>
            )}
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem 
                  onClick={hasEditPermission ? handleTogglePauseResume : undefined} 
                  disabled={!hasEditPermission || isPauseResumeLoading}
                  className={!hasEditPermission ? "opacity-50 cursor-not-allowed" : ""}
                >
                  {monitor.status === 'paused' ? (
                    <>
                      <PlayIcon className="mr-2 h-4 w-4 text-green-500" />
                      <span>Resume</span>
                    </>
                  ) : (
                    <>
                      <PauseIcon className="mr-2 h-4 w-4 text-amber-500" />
                      <span>Pause</span>
                    </>
                  )}
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            {!hasEditPermission && (
              <TooltipContent>
                <p>Insufficient permissions to control monitors</p>
              </TooltipContent>
            )}
          </Tooltip>
          
          <DropdownMenuSeparator />
          
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem
                  onClick={hasDeletePermission ? (e) => {
                    e.stopPropagation();
                    setShowDeleteDialog(true);
                  } : undefined}
                  disabled={!hasDeletePermission}
                  className={`${!hasDeletePermission ? "opacity-50 cursor-not-allowed" : "text-red-600"}`}
                >
                  <TrashIcon className="mr-2 h-4 w-4" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            {!hasDeletePermission && (
              <TooltipContent>
                <p>Insufficient permissions to delete monitors</p>
              </TooltipContent>
            )}
          </Tooltip>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Monitor</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the monitor <span className="font-semibold">&quot;{monitor.name}&quot;</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteMonitor();
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