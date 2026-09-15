import { redirect } from "next/navigation";

export default function OrgAdminPrivateAgentsPage() {
  redirect("/org-admin?tab=private-agents");
}
