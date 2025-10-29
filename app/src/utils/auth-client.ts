import { createAuthClient } from "better-auth/react";
import {
  apiKeyClient,
  organizationClient,
  adminClient,
} from "better-auth/client/plugins";
import { ac, roles, Role } from "@/lib/rbac/permissions";

export const authClient = createAuthClient({
  /** The base URL of the server (optional if you're using the same domain) */
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    apiKeyClient(),
    organizationClient({
      ac,
      roles: {
        org_owner: roles[Role.ORG_OWNER],
        org_admin: roles[Role.ORG_ADMIN],
        project_admin: roles[Role.PROJECT_ADMIN],
        project_editor: roles[Role.PROJECT_EDITOR],
        project_viewer: roles[Role.PROJECT_VIEWER],
      },
    }),
    adminClient({
      ac,
      roles: {
        org_admin: roles[Role.ORG_ADMIN],
        super_admin: roles[Role.SUPER_ADMIN],
      },
    }),
  ],
});

export const {
  signIn,
  signUp,
  useSession,
  signOut,
  forgetPassword,
  resetPassword,
  // Organization methods
  organization: {
    create: createOrganization,
    list: listOrganizations,
    setActive: setActiveOrganization,
    // getActive: getActiveOrganization, // Not available in client
    inviteMember: inviteToOrganization,
    removeMember: removeMemberFromOrganization,
    updateMemberRole: updateOrganizationMemberRole,
    acceptInvitation: acceptOrganizationInvitation,
    rejectInvitation: rejectOrganizationInvitation,
    // listMembers: listOrganizationMembers, // Not available in client
    // listInvitations: listOrganizationInvitations // Not available in client
  },
  // Admin methods
  admin: {
    listUsers: listAllUsers,
    createUser: createUserAsAdmin,
    // setUserRole: setUserRole, // Not available in client
    banUser: banUser,
    unbanUser: unbanUser,
    impersonateUser: impersonateUser,
    // listSessions: listUserSessions, // Not available in client
    // revokeSession: revokeUserSession, // Not available in client
    removeUser: removeUser,
  },
} = authClient;
