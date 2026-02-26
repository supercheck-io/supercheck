import { createAuthClient } from "better-auth/react";
import {
  apiKeyClient,
  organizationClient,
  adminClient,
  lastLoginMethodClient,
} from "better-auth/client/plugins";
import { polarClient } from "@polar-sh/better-auth";

/**
 * Better Auth client for browser-side authentication.
 *
 * PERFORMANCE OPTIMIZATION:
 * Session options are configured to minimize refetch triggers that can cause
 * blocking behavior. Window focus refetch is disabled to prevent cascade
 * session checks across multiple components when switching tabs.
 */
export const authClient = createAuthClient({
  /** The base URL of the server (optional if you're using the same domain) */
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    apiKeyClient(),
    organizationClient({
      // Note: In Better Auth 1.4.x, the client plugin uses rolePermissions directly
      // The ac/roles from server-side are not needed on client
    }),
    adminClient({
      // Note: Admin client doesn't need ac/roles on client side
    }),
    // Track last login method to show "Last used" badge on sign-in page
    lastLoginMethodClient(),
    // Polar client plugin for checkout and customer portal
    polarClient(),
  ],
  // PERFORMANCE: Reduce session refetch triggers to prevent blocking
  fetchOptions: {
    // Default fetch options for auth requests
  },
});

export const {
  signIn,
  signUp,
  useSession,
  signOut,
  requestPasswordReset, // Changed from forgetPassword in Better Auth 1.4.x
  resetPassword,
  sendVerificationEmail,
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
