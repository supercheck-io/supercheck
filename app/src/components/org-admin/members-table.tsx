"use client";

import * as React from "react";
import { type Table as TableType } from "@tanstack/react-table";
import { useSession } from "@/utils/auth-client";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { MemberTableToolbar } from "./member-table-toolbar";
import { createMemberColumns, type MemberOrInvitation } from "./member-columns";

interface MembersTableProps {
  members: MemberOrInvitation[];
  onMemberUpdate: () => void;
  onInviteMember: () => void;
  canInviteMembers?: boolean;
  currentUserRole?: string;
  projects?: { id: string; name: string; description?: string }[];
}

// Custom global filter function for members table
function memberGlobalFilterFn(
  row: { original: MemberOrInvitation },
  _columnId: string,
  filterValue: string
) {
  if (!filterValue) return true;
  const search = String(filterValue).toLowerCase();
  const item = row.original;

  // Search in name, email fields
  if (item.type === "invitation") {
    return (
      item.email.toLowerCase().includes(search) ||
      item.inviterName.toLowerCase().includes(search)
    );
  } else {
    return (
      item.name.toLowerCase().includes(search) ||
      item.email.toLowerCase().includes(search)
    );
  }
}

export function MembersTable({
  members,
  onMemberUpdate,
  onInviteMember,
  canInviteMembers = false,
  projects = [],
  currentUserRole,
}: MembersTableProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const columns = React.useMemo(
    () => createMemberColumns(onMemberUpdate, projects, currentUserId, currentUserRole),
    [onMemberUpdate, projects, currentUserId, currentUserRole]
  );

  const CustomToolbar = React.useCallback(
    ({ table }: { table: TableType<MemberOrInvitation> }) => (
      <MemberTableToolbar
        table={table}
        onInviteMember={onInviteMember}
        canInviteMembers={canInviteMembers}
      />
    ),
    [onInviteMember, canInviteMembers]
  );

  return (
    <AdminDataTable
      columns={columns}
      data={members}
      toolbar={CustomToolbar}
      itemName="members"
      meta={{
        globalFilterColumns: ["name", "email"],
        globalFilterFn: memberGlobalFilterFn,
      }}
    />
  );
}
