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
import { UserMinus, Crown, Shield, User, Eye, Edit3 } from "lucide-react";
import { toast } from "sonner";
import React, { useState } from "react";
import { DataTableColumnHeader } from "@/components/tests/data-table-column-header";

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role: 'org_owner' | 'org_admin' | 'project_admin' | 'project_editor' | 'project_viewer';
  joinedAt: string;
  type: 'member';
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'expired';
  expiresAt: string;
  inviterName: string;
  inviterEmail: string;
  type: 'invitation';
}

export type MemberOrInvitation = OrgMember | PendingInvitation;


const handleRemoveMember = async (memberId: string, memberName: string, onUpdate: () => void) => {
  try {
    const response = await fetch(`/api/organizations/members/${memberId}`, {
      method: 'DELETE',
    });

    const data = await response.json();

    if (data.success) {
      toast.success('Member removed successfully');
      onUpdate();
    } else {
      toast.error(data.error || 'Failed to remove member');
    }
  } catch (error) {
    console.error('Error removing member:', error);
    toast.error('Failed to remove member');
  }
};

// Component to confirm member removal
const RemoveMemberConfirmDialog = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  memberName 
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
            Are you sure you want to remove <strong>{memberName}</strong> from the organization? 
            This action cannot be undone and they will lose access to all projects and data.
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

const getRoleIcon = (role: string) => {
  switch (role) {
    case 'org_owner':
      return <Crown className="mr-2 h-4 w-4" />;
    case 'org_admin':
      return <Shield className="mr-2 h-4 w-4" />;
    case 'project_admin':
      return <Shield className="mr-2 h-4 w-4" />;
    case 'project_editor':
      return <User className="mr-2 h-4 w-4" />;
    case 'project_viewer':
      return <Eye className="mr-2 h-4 w-4" />;
    default:
      return <User className="mr-2 h-4 w-4" />;
  }
};

const getRoleColor = (role: string, isInvitation = false) => {
  if (isInvitation) return 'bg-orange-100 text-orange-700';
  
  switch (role) {
    case 'org_owner':
      return 'bg-purple-100 text-purple-700';
    case 'org_admin':
      return 'bg-blue-100 text-blue-700';
    case 'project_admin':
      return 'bg-indigo-100 text-indigo-700';
    case 'project_editor':
      return 'bg-green-100 text-green-700';
    case 'project_viewer':
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-700';
    case 'accepted':
      return 'bg-green-100 text-green-700';
    case 'expired':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

// All roles are now in new RBAC format - no conversion needed

// Member Actions Cell Component
const MemberActionsCell = ({ 
  member, 
  onMemberUpdate,
  projects: initialProjects
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
  const [projects, setProjects] = useState<{ id: string; name: string; description?: string }[]>(initialProjects);
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
      const response = await fetch('/api/projects');
      const data = await response.json();

      if (data.success) {
        const activeProjects = data.data.filter((project: { id: string; name: string; description?: string; status: string }) => project.status === 'active');
        setProjects(activeProjects);
        return activeProjects;
      } else {
        console.error('Failed to fetch projects:', data.error);
        toast.error('Failed to load projects');
        return [];
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast.error('Failed to load projects');
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
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json') && response.ok) {
        const data = await response.json();
        if (data.success && data.projects) {
          selectedProjects = data.projects.map((p: { projectId: string }) => p.projectId);
        }
      }
      
      // For project_viewer role, they should have access to all projects automatically
      // But we don't need to set selectedProjects since our dialog handles this
      if (member.role === 'project_viewer') {
        selectedProjects = [];
      }
      
      setMemberData({
        email: member.email,
        role: member.role,
        selectedProjects
      });
      setShowEditDialog(true);
    } catch (error) {
      console.error('Error fetching member projects:', error);
      // Fallback to default data
      setMemberData({
        email: member.email,
        role: member.role,
        selectedProjects: member.role === 'project_viewer' ? [] : []
      });
      setShowEditDialog(true);
    }
  };

  if (member.role === 'org_owner') {
    return (
      <div className="py-1 flex justify-start">
        <span className="text-muted-foreground text-sm">None</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 py-1">
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
            selectedProjects: memberData.selectedProjects
          }}
          projects={projects}
          onSubmit={async (updatedData) => {
            const response = await fetch(`/api/organizations/members/${member.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                role: updatedData.role,
                projectAssignments: updatedData.selectedProjects.map(projectId => ({
                  projectId,
                  role: updatedData.role
                }))
              }),
            });

            const data = await response.json();

            if (data.success) {
              onMemberUpdate();
            } else {
              throw new Error(data.error || 'Failed to update member access');
            }
          }}
        />
      )}
    </>
  );
};

export const createMemberColumns = (onMemberUpdate: () => void, projects: { id: string; name: string; description?: string }[] = []): ColumnDef<MemberOrInvitation>[] => [
  {
    accessorKey: "name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Member" />
    ),
    size: 250,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === 'invitation';
      
      return (
        <div className="py-1 flex items-center">
          <div>
            <div className="font-medium text-sm">
              {isInvitation ? (item as PendingInvitation).email : (item as OrgMember).name}
            </div>
            <div className="text-xs text-muted-foreground">
              {isInvitation 
                ? `Invited by ${(item as PendingInvitation).inviterName}`
                : (item as OrgMember).email
              }
            </div>
          </div>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const item = row.original;
      const searchText = item.type === 'invitation' 
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
      const isInvitation = item.type === 'invitation';
      const role = isInvitation ? (item as PendingInvitation).role : (item as OrgMember).role;
      
      return (
        <div className="py-1 flex items-center">
          <Badge 
            variant="outline" 
            className={`${getRoleColor(role, isInvitation)} text-xs px-3 py-1.5 font-medium capitalize`}
          >
            {getRoleIcon(role)}
            {role}
          </Badge>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const item = row.original;
      const role = item.type === 'invitation' ? (item as PendingInvitation).role : (item as OrgMember).role;
      return value.includes(role);
    },
  },
  {
    id: "status",
    accessorFn: (row) => {
      return row.type === 'invitation' ? (row as PendingInvitation).status : 'active';
    },
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    size: 120,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === 'invitation';
      
      return (
        <div className="py-1 flex items-center">
          {isInvitation ? (
            <Badge variant="outline" className={`${getStatusColor((item as PendingInvitation).status)} text-xs px-3 py-1.5 font-medium capitalize`}>
              {(item as PendingInvitation).status}
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-green-100 text-green-700 text-xs px-3 py-1.5 font-medium capitalize">
              Active
            </Badge>
          )}
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const item = row.original;
      const status = item.type === 'invitation' ? (item as PendingInvitation).status : 'active';
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
      const isInvitation = item.type === 'invitation';
      
      return (
        <div className="py-1 flex items-center">
          {isInvitation ? (
            <div className="text-sm">
              <div className="text-muted-foreground text-xs">Expires:</div>
              <div className="font-medium">
                {(() => {
                  const date = new Date((item as PendingInvitation).expiresAt);
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
                    <>
                      <span>{formattedDate}</span>
                      <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
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
                  const date = new Date((item as OrgMember).joinedAt);
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
                    <>
                      <span>{formattedDate}</span>
                      <span className="text-muted-foreground ml-1 text-xs">{formattedTime}</span>
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
    id: "actions",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Actions" />
    ),
    size: 200,
    cell: ({ row }) => {
      const item = row.original;
      const isInvitation = item.type === 'invitation';

      if (isInvitation) {
        return (
          <div className="py-1 flex justify-start">
            <span className="text-muted-foreground text-sm">None</span>
          </div>
        );
      }

      const member = item as OrgMember;
      return <MemberActionsCell member={member} onMemberUpdate={onMemberUpdate} projects={projects} />;
    },
  },
];