"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemberAccessDialog } from "@/components/members/MemberAccessDialog";
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
import {
  UserMinus,
  Crown,
  Shield,
  User,
  Eye,
  Edit3,
  Mail,
  XCircle,
  FolderOpen,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TableBadge,
  type TableBadgeTone,
  TABLE_BADGE_BASE_CLASS,
  TABLE_BADGE_COMPACT_CLASS,
} from "@/components/ui/table-badge";
import { toast } from "sonner";
import React, { useState } from "react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";
import { UUIDField } from "@/components/ui/uuid-field";

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role:
    | "org_owner"
    | "org_admin"
    | "project_admin"
    | "project_editor"
    | "project_viewer";
  joinedAt: string;
  type: "member";
  projects?: { projectId: string; projectName: string }[];
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  status: "pending" | "expired";
  expiresAt: string;
  inviterName: string;
  inviterEmail: string;
  type: "invitation";
}

export type MemberOrInvitation = OrgMember | PendingInvitation;

const BADGE_BASE_CLASS = TABLE_BADGE_BASE_CLASS;
const PROJECT_BADGE_CLASS = `${TABLE_BADGE_COMPACT_CLASS} max-w-[120px]`;

const roleBadgeConfig: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: TableBadgeTone;
  }
> = {
  org_owner: {
    label: "Org Owner",
    icon: Crown,
    tone: "purple",
  },
  org_admin: {
    label: "Org Admin",
    icon: Shield,
    tone: "info",
  },
  project_admin: {
    label: "Project Admin",
    icon: Shield,
    tone: "warning",
  },
  project_editor: {
    label: "Project Editor",
    icon: User,
    tone: "success",
  },
  project_viewer: {
    label: "Project Viewer",
    icon: Eye,
    tone: "slate",
  },
};

const statusBadgeConfig: Record<string, { label: string; tone: TableBadgeTone }> = {
  active: {
    label: "Active",
    tone: "success",
  },
  pending: {
    label: "Pending",
    tone: "warning",
  },
  expired: {
    label: "Expired",
    tone: "danger",
  },
};

const formatRoleLabel = (role: string | null | undefined) => {
  if (!role) {
    return "Unknown Role";
  }

  return role
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

const RoleBadge = ({
  role,
  isInvitation,
}: {
  role: string | null | undefined;
  isInvitation?: boolean;
}) => {
  const normalizedRole = role ?? "";

  if (isInvitation) {
    return (
      <TableBadge tone="warning" className={BADGE_BASE_CLASS}>
        <Mail className="mr-1 h-3.5 w-3.5" />
        {formatRoleLabel(normalizedRole)}
      </TableBadge>
    );
  }

  const config = roleBadgeConfig[normalizedRole] ?? {
    label: formatRoleLabel(normalizedRole),
    icon: User,
    tone: "slate" as const,
  };
  const Icon = config.icon;

  return (
    <TableBadge tone={config.tone} className={BADGE_BASE_CLASS}>
      <Icon className="mr-1 h-3.5 w-3.5" />
      {config.label}
    </TableBadge>
  );
};

const StatusBadge = ({ status }: { status: "active" | "pending" | "expired" }) => {
  const config = statusBadgeConfig[status];

  return (
    <TableBadge tone={config.tone} className={BADGE_BASE_CLASS}>
      {config.label}
    </TableBadge>
  );
};

const handleRemoveMember = async (
  memberId: string,
  memberName: string,
  onUpdate: () => void
) => {
  try {
    const response = await fetch(`/api/organizations/members/${memberId}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (data.success) {
      toast.success("Member removed successfully");
      onUpdate();
    } else {
      toast.error(data.error || "Failed to remove member");
    }
  } catch (error) {
    console.error("Error removing member:", error);
    toast.error("Failed to remove member");
  }
};

// Component to confirm member removal
const RemoveMemberConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  memberName,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  memberName: string;
}) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove member?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove <strong>{memberName}</strong> from
            the organization? This action cannot be undone and they will lose
            access to all projects and data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            Remove Member
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// All roles are now in new RBAC format - no conversion needed

// Member Actions Cell Component
const MemberActionsCell = ({
  member,
  onMemberUpdate,
  projects: initialProjects,
}: {
  member: OrgMember;
  onMemberUpdate: () => void;
  projects: { id: string; name: string; description?: string }[];
}) => {
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [memberData, setMemberData] = useState<{
    email: string;
    role: string;
    selectedProjects: string[];
  } | null>(null);
  const [projects, setProjects] =
    useState<{ id: string; name: string; description?: string }[]>(
      initialProjects
    );
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Update projects when initialProjects prop changes
  React.useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const fetchProjects = async () => {
    // If projects are already loaded, don't fetch again
    if (projects.length > 0) {
      return projects;
    }

    setLoadingProjects(true);
    try {
      const response = await fetch("/api/projects");
      const data = await response.json();

      if (data.success) {
        const activeProjects = data.data.filter(
          (project: {
            id: string;
            name: string;
            description?: string;
            status: string;
          }) => project.status === "active"
        );
        setProjects(activeProjects);
        return activeProjects;
      } else {
        console.error("Failed to fetch projects:", data.error);
        toast.error("Failed to load projects");
        return [];
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
      toast.error("Failed to load projects");
      return [];
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleRemoveClick = () => {
    setShowRemoveDialog(true);
  };

  const handleConfirmRemove = () => {
    handleRemoveMember(member.id, member.name, onMemberUpdate);
    setShowRemoveDialog(false);
  };

  const handleEditAccess = async () => {
    try {
      // Ensure projects are loaded first
      await fetchProjects();

      // Fetch current member project assignments from projectMembers table
      const response = await fetch(`/api/projects/members/${member.id}`);

      let selectedProjects: string[] = [];

      // Check if response is JSON and successful
      const contentType = response.headers.get("content-type");
      if (
        contentType &&
        contentType.includes("application/json") &&
        response.ok
      ) {
        const data = await response.json();
        if (data.success && data.projects) {
          selectedProjects = data.projects.map(
            (p: { projectId: string }) => p.projectId
          );
        }
      }

      // For project_viewer role, they should have access to all projects automatically
      // But we don't need to set selectedProjects since our dialog handles this
      if (member.role === "project_viewer") {
        selectedProjects = [];
      }

      setMemberData({
        email: member.email,
        role: member.role,
        selectedProjects,
      });
      setShowEditDialog(true);
    } catch (error) {
      console.error("Error fetching member projects:", error);
      // Fallback to default data
      setMemberData({
        email: member.email,
        role: member.role,
        selectedProjects: member.role === "project_viewer" ? [] : [],
      });
      setShowEditDialog(true);
    }
  };

  if (member.role === "org_owner") {
    return <span className="text-muted-foreground text-sm">None</span>;
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-700 border-gray-200 hover:border-gray-300 transition-all duration-200 rounded-md shadow-sm"
          onClick={handleEditAccess}
          title="Edit Access"
          disabled={loadingProjects}
        >
          {loadingProjects ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Edit3 className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 transition-all duration-200 rounded-md shadow-sm"
          onClick={handleRemoveClick}
          title="Remove Member"
        >
          <UserMinus className="h-4 w-4" />
        </Button>
      </div>

      <RemoveMemberConfirmDialog
        isOpen={showRemoveDialog}
        onClose={() => setShowRemoveDialog(false)}
        onConfirm={handleConfirmRemove}
        memberName={member.name}
      />

      {memberData && (
        <MemberAccessDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          mode="edit"
          member={{
            id: member.id,
            name: member.name,
            email: memberData.email,
            role: memberData.role,
            selectedProjects: memberData.selectedProjects,
          }}
          projects={projects}
          onSubmit={async (updatedData) => {
            const response = await fetch(
              `/api/organizations/members/${member.id}`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  role: updatedData.role,
                  projectAssignments: updatedData.selectedProjects.map(
                    (projectId) => ({
                      projectId,
                      role: updatedData.role,
                    })
                  ),
                }),
              }
            );

            const data = await response.json();

            if (data.success) {
              onMemberUpdate();
              return {
                successMessage:
                  data.message || `Updated access for ${member.name}`,
              };
            } else {
              throw new Error(data.error || "Failed to update member access");
            }
          }}
        />
      )}
    </>
  );
};

// Component to confirm invitation cancellation
const CancelInvitationConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  email,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  email: string;
}) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel invitation?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel the invitation for{" "}
            <strong>{email}</strong>? They will no longer be able to accept this
            invitation.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Invitation</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            Cancel Invitation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

// Invitation Actions Cell Component
const InvitationActionsCell = ({
  invitation,
  onMemberUpdate,
}: {
  invitation: PendingInvitation;
  onMemberUpdate: () => void;
}) => {
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [resending, setResending] = useState(false);

  const handleResendInvitation = async () => {
    setResending(true);
    try {
      const response = await fetch(
        `/api/organizations/members/invite/${invitation.id}`,
        { method: "POST" }
      );
      const data = await response.json();

      if (data.success) {
        toast.success(`Invitation resent to ${invitation.email}`);
        onMemberUpdate();
      } else {
        toast.error(data.error || "Failed to resend invitation");
      }
    } catch (error) {
      console.error("Error resending invitation:", error);
      toast.error("Failed to resend invitation");
    } finally {
      setResending(false);
    }
  };

  const handleCancelInvitation = async () => {
    try {
      const response = await fetch(
        `/api/organizations/members/invite/${invitation.id}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (data.success) {
        toast.success("Invitation cancelled");
        onMemberUpdate();
      } else {
        toast.error(data.error || "Failed to cancel invitation");
      }
    } catch (error) {
      console.error("Error cancelling invitation:", error);
      toast.error("Failed to cancel invitation");
    }
    setShowCancelDialog(false);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 bg-blue-50 hover:bg-blue-100 text-blue-600 hover:text-blue-700 border-blue-200 hover:border-blue-300 transition-all duration-200 rounded-md shadow-sm"
          onClick={handleResendInvitation}
          disabled={resending}
          title="Resend Invitation"
        >
          {resending ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Mail className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 transition-all duration-200 rounded-md shadow-sm"
          onClick={() => setShowCancelDialog(true)}
          title="Cancel Invitation"
        >
          <XCircle className="h-4 w-4" />
        </Button>
      </div>

      <CancelInvitationConfirmDialog
        isOpen={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        onConfirm={handleCancelInvitation}
        email={invitation.email}
      />
    </>
  );
};

export const createMemberColumns = (
  onMemberUpdate: () => void,
  projects: { id: string; name: string; description?: string }[] = []
): ColumnDef<MemberOrInvitation>[] => [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <DataTableColumnHeader className="pl-1" column={column} title="ID" />
    ),
    cell: ({ row }) => {
      const id = row.getValue("id") as string;
      return (
        <div className="flex items-center h-10">
          <UUIDField
            value={id}
            maxLength={8}
            onCopy={() => toast.success("ID copied to clipboard")}
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
      <DataTableColumnHeader column={column} title="Member" />
    ),
    size: 250,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === "invitation";

      return (
        <div className="flex items-center h-10">
          <div>
            <div className="font-medium text-sm">
              {isInvitation
                ? (item as PendingInvitation).email
                : (item as OrgMember).name}
            </div>
            <div className="text-xs text-muted-foreground">
              {isInvitation
                ? `Invited by ${(item as PendingInvitation).inviterName}`
                : (item as OrgMember).email}
            </div>
          </div>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const item = row.original;
      const searchText =
        item.type === "invitation"
          ? (item as PendingInvitation).email
          : `${(item as OrgMember).name} ${(item as OrgMember).email}`;
      return searchText.toLowerCase().includes(value.toLowerCase());
    },
  },
  {
    accessorKey: "role",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Role" />
    ),
    size: 120,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === "invitation";
      const role = isInvitation
        ? (item as PendingInvitation).role
        : (item as OrgMember).role;

      return (
        <div className="flex items-center h-10">
          <RoleBadge role={role} isInvitation={isInvitation} />
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const item = row.original;
      const role =
        item.type === "invitation"
          ? (item as PendingInvitation).role
          : (item as OrgMember).role;
      return value.includes(role);
    },
  },
  {
    id: "status",
    accessorFn: (row) => {
      return row.type === "invitation"
        ? (row as PendingInvitation).status
        : "active";
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    size: 120,
    cell: ({ row }) => {
      const item = row.original;
      const status =
        item.type === "invitation"
          ? (item as PendingInvitation).status
          : "active";

      return (
        <div className="flex items-center h-10">
          <StatusBadge
            status={status as "active" | "pending" | "expired"}
          />
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const item = row.original;
      const status =
        item.type === "invitation"
          ? (item as PendingInvitation).status
          : "active";
      return value.includes(status);
    },
  },
  {
    accessorKey: "joinedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date" />
    ),
    size: 140,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === "invitation";

      const formatDateTime = (dateString: string) => {
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

      return (
        <div className="flex items-center h-10">
          {isInvitation ? (
            <div className="text-sm">
              <div className="text-muted-foreground text-xs">Expires:</div>
              <div className="font-medium">
                {(() => {
                  const { formattedDate, formattedTime } = formatDateTime(
                    (item as PendingInvitation).expiresAt
                  );
                  return (
                    <>
                      <span>{formattedDate}</span>
                      <span className="text-muted-foreground ml-1 text-xs">
                        {formattedTime}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <div className="text-muted-foreground text-xs">Joined:</div>
              <div className="font-medium">
                {(() => {
                  const { formattedDate, formattedTime } = formatDateTime(
                    (item as OrgMember).joinedAt
                  );
                  return (
                    <>
                      <span>{formattedDate}</span>
                      <span className="text-muted-foreground ml-1 text-xs">
                        {formattedTime}
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      );
    },
  },
  {
    id: "projects",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Projects" />
    ),
    size: 200,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === "invitation";

      if (isInvitation) {
        return (
          <div className="flex items-center h-10">
            <span className="text-muted-foreground text-sm">—</span>
          </div>
        );
      }

      const member = item as OrgMember;
      const memberProjects = member.projects ?? [];

      // Org-level and viewer roles all have access to all projects.
      if (
        member.role === "org_owner" ||
        member.role === "org_admin" ||
        member.role === "project_viewer"
      ) {
        return (
          <div className="flex items-center h-10">
            <Badge
              variant="secondary"
              className={`${BADGE_BASE_CLASS} bg-muted text-foreground`}
            >
              <FolderOpen className="mr-1 h-3.5 w-3.5" />
              All Projects
            </Badge>
          </div>
        );
      }

      if (memberProjects.length === 0) {
        return (
          <div className="flex items-center h-10">
            <span className="text-muted-foreground text-sm">None</span>
          </div>
        );
      }

      // Show up to 2 project badges + count for overflow
      const displayProjects = memberProjects.slice(0, 2);
      const remaining = memberProjects.length - displayProjects.length;

      const trigger = (
        <div className="flex items-center h-10 gap-1">
          {displayProjects.map((project) => (
            <Badge
              key={project.projectId}
              variant="secondary"
              className={`${PROJECT_BADGE_CLASS} bg-muted text-foreground`}
              title={project.projectName}
            >
              <span className="truncate">{project.projectName}</span>
            </Badge>
          ))}
          {remaining > 0 && (
            <Badge
              variant="secondary"
              className={`${BADGE_BASE_CLASS} bg-muted text-muted-foreground`}
            >
              +{remaining}
            </Badge>
          )}
        </div>
      );

      if (remaining <= 0) {
        return trigger;
      }

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="top" className="max-w-[420px]">
              <div className="flex flex-wrap gap-1">
                {memberProjects.map((project) => (
                  <Badge
                    key={project.projectId}
                    variant="secondary"
                    className={`${PROJECT_BADGE_CLASS} bg-muted text-foreground`}
                    title={project.projectName}
                  >
                    <span className="truncate">{project.projectName}</span>
                  </Badge>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    id: "actions",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Actions" />
    ),
    size: 200,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === "invitation";

      if (isInvitation) {
        const inv = item as PendingInvitation;
        return (
          <div className="flex items-center h-10">
            <InvitationActionsCell
              invitation={inv}
              onMemberUpdate={onMemberUpdate}
            />
          </div>
        );
      }

      const member = item as OrgMember;
      return (
        <div className="flex items-center h-10">
          <MemberActionsCell
            member={member}
            onMemberUpdate={onMemberUpdate}
            projects={projects}
          />
        </div>
      );
    },
  },
];
