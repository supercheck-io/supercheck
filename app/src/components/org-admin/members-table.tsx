"use client";

import * as React from "react";
import { type Table as TableType } from "@tanstack/react-table";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { MemberTableToolbar } from "./member-table-toolbar";
import { createMemberColumns, type MemberOrInvitation } from "./member-columns";

interface MembersTableProps {
  members: MemberOrInvitation[];
  onMemberUpdate: () => void;
  onInviteMember: () => void;
  canInviteMembers?: boolean;
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
}: MembersTableProps) {
  const columns = React.useMemo(
    () => createMemberColumns(onMemberUpdate, projects),
    [onMemberUpdate, projects]
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
      title="Members"
      description="Manage organization members and their roles. View pending invitations."
      itemName="members"
      meta={{
        globalFilterColumns: ["name", "email"],
        globalFilterFn: memberGlobalFilterFn,
        initialPageSize: 8,
      }}
    />
  );
}
