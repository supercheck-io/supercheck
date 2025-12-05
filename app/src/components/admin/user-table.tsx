"use client";

import * as React from "react";
import { AdminDataTable } from "./admin-data-table";
import { UserTableToolbar } from "./user-table-toolbar";
import { createUserColumns, AdminUser } from "./user-columns";

interface UserTableProps {
  users: AdminUser[];
  onUserUpdate: () => void;
}

export function UserTable({ users, onUserUpdate }: UserTableProps) {
  const columns = React.useMemo(
    () => createUserColumns(onUserUpdate),
    [onUserUpdate]
  );

  // Extract unique organizations from users for filtering
  const uniqueOrganizations = React.useMemo(() => {
    const orgsMap = new Map<string, { id: string; name: string }>();
    users.forEach((user) => {
      user.organizations?.forEach((org) => {
        if (!orgsMap.has(org.organizationId)) {
          orgsMap.set(org.organizationId, {
            id: org.organizationId,
            name: org.organizationName,
          });
        }
      });
    });
    return Array.from(orgsMap.values());
  }, [users]);

   
  const CustomToolbar = React.useCallback(
    ({ table }: { table: any }) => (
      <UserTableToolbar table={table} organizations={uniqueOrganizations} />
    ),
    [uniqueOrganizations]
  );

  return (
    <AdminDataTable
      columns={columns}
      data={users}
      toolbar={CustomToolbar}
      title="Users"
      description="Manage system users and their roles"
      itemName="users"
      meta={{
        globalFilterColumns: ["name", "email", "role"],
      }}
    />
  );
}
