import { redirect } from "next/navigation";

export default function OrgAdminDiagnosticQueriesPage() {
  redirect("/org-admin?tab=integrations&section=saved-queries");
}
