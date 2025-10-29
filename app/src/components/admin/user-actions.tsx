"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/utils/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
} from "@/components/ui/alert-dialog";
import { MoreHorizontal, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { ImpersonateDialog } from "./impersonate-dialog";
import { AdminUser } from "./user-columns";

interface UserActionsProps {
  user: AdminUser;
  onUserUpdate: () => void;
}

const handleBanUser = async (
  userId: string,
  reason: string,
  onUpdate: () => void
) => {
  try {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        action: "ban",
        reason,
      }),
    });

    const data = await response.json();

    if (data.success) {
      toast.success("User banned successfully");
      onUpdate();
    } else {
      toast.error(data.error || "Failed to ban user");
    }
  } catch (error) {
    console.error("Error banning user:", error);
    toast.error("Failed to ban user");
  }
};

const handleUnbanUser = async (userId: string, onUpdate: () => void) => {
  try {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        action: "unban",
      }),
    });

    const data = await response.json();

    if (data.success) {
      toast.success("User unbanned successfully");
      onUpdate();
    } else {
      toast.error(data.error || "Failed to unban user");
    }
  } catch (error) {
    console.error("Error unbanning user:", error);
    toast.error("Failed to unban user");
  }
};

export function UserActions({ user, onUserUpdate }: UserActionsProps) {
  const { data: session } = useSession();
  const [impersonateDialogOpen, setImpersonateDialogOpen] = useState(false);
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState("");

  const currentUser = session?.user;
  const isCurrentUser = currentUser?.id === user.id;

  const validateBanReason = (reason: string) => {
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) {
      return "Ban reason is required";
    }
    if (trimmedReason.length < 20) {
      return "Ban reason must be at least 20 characters";
    }
    if (trimmedReason.length > 100) {
      return "Ban reason must be less than 100 characters";
    }
    return "";
  };

  const handleBanConfirm = async () => {
    const error = validateBanReason(banReason);
    if (error) {
      setValidationError(error);
      return;
    }

    setIsSubmitting(true);
    setValidationError("");

    try {
      await handleBanUser(user.id, banReason.trim(), onUserUpdate);
      setBanDialogOpen(false);
      setBanReason("");
    } catch (error) {
      console.error("Error banning user:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBanCancel = () => {
    setBanDialogOpen(false);
    setBanReason("");
    setValidationError("");
    setIsSubmitting(false);
  };

  const handleReasonChange = (value: string) => {
    setBanReason(value);
    if (validationError) {
      const error = validateBanReason(value);
      setValidationError(error);
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
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => setImpersonateDialogOpen(true)}
            disabled={isCurrentUser}
          >
            <UserCheck className="mr-2 h-4 w-4" />
            {isCurrentUser ? "Can't Impersonate Yourself" : "Impersonate"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.banned ? (
            <DropdownMenuItem
              onClick={() => handleUnbanUser(user.id, onUserUpdate)}
              disabled={isCurrentUser}
            >
              <UserCheck className="mr-2 h-4 w-4" />
              {isCurrentUser ? "Can't Unban Yourself" : "Unban User"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => setBanDialogOpen(true)}
              className="text-destructive"
              disabled={isCurrentUser}
            >
              <UserX className="mr-2 h-4 w-4" />
              {isCurrentUser ? "Can't Ban Yourself" : "Ban User"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ImpersonateDialog
        open={impersonateDialogOpen}
        onOpenChange={setImpersonateDialogOpen}
        userId={user.id}
        userName={user.name}
        userEmail={user.email}
      />

      <AlertDialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban User</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to ban <strong>{user.name}</strong> ({user.email}).
              Please provide a reason for this action. This action can be
              reversed later.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="ban-reason"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Ban Reason
              </label>
              <textarea
                id="ban-reason"
                placeholder="Enter ban reason (20-100 characters)..."
                value={banReason}
                onChange={(e) => handleReasonChange(e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 mt-2"
                rows={3}
                maxLength={100}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleBanConfirm();
                  }
                }}
              />
              {validationError && (
                <p className="text-sm font-medium text-destructive mt-2">
                  {validationError}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {banReason.length}/100 characters
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleBanCancel}
              disabled={isSubmitting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBanConfirm}
              disabled={isSubmitting || validateBanReason(banReason) !== ""}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isSubmitting ? "Banning..." : "Ban User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
