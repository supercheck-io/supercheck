import { redirect } from "next/navigation";

export default function OrgAdminConnectorsPage() {
  redirect("/org-admin?tab=integrations");
}
