import { redirect } from "next/navigation";

export default function OrgAdminDiagnosticQueriesPage() {
  redirect("/org-admin?tab=diagnostic-recipes");
}
