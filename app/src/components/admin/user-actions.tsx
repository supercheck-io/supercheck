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
import { MoreHorizontal, UserCheck, UserX, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ImpersonateDialog } from "./impersonate-dialog";
import { BanUserDialog } from "./ban-user-dialog";
import { AdminUser } from "./user-columns";

interface UserActionsProps {
  user: AdminUser;
  onUserUpdate: () => void;
}

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
  const [isUnbanning, setIsUnbanning] = useState(false);

  const currentUser = session?.user;
  const isCurrentUser = currentUser?.id === user.id;

  const handleUnban = async () => {
    setIsUnbanning(true);
    try {
      await handleUnbanUser(user.id, onUserUpdate);
    } finally {
      setIsUnbanning(false);
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
              onClick={handleUnban}
              disabled={isCurrentUser || isUnbanning}
            >
              {isUnbanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserCheck className="mr-2 h-4 w-4" />
              )}
              {isCurrentUser ? "Can't Unban Yourself" : "Unban User"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => setBanDialogOpen(true)}
              className="text-destructive focus:text-destructive"
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

      <BanUserDialog
        open={banDialogOpen}
        onOpenChange={setBanDialogOpen}
        userId={user.id}
        userName={user.name}
        userEmail={user.email}
        onSuccess={onUserUpdate}
      />
    </>
  );
}
