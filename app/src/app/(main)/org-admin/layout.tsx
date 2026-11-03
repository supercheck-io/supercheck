import { getCachedAuthSession } from "@/lib/session-cache";
import { redirect } from "next/navigation";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { getActiveOrganization, getCurrentUser } from "@/lib/session";
import { Metadata } from "next/types";

export const metadata: Metadata = {
  title: "Organization | Supercheck",
  description: "View and manage all organization settings",
};


export default async function OrgAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCachedAuthSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Check organization admin permissions
  const currentUser = await getCurrentUser();
  const activeOrg = await getActiveOrganization();
  
  if (!currentUser || !activeOrg) {
    redirect("/");
  }

  const orgRole = await getUserOrgRole(currentUser.id, activeOrg.id);
  const isOrgAdmin = orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
  
  if (!isOrgAdmin) {
    redirect("/");
  }

  return children;
}