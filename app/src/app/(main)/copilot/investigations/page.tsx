import { redirect } from "next/navigation";

export default function LegacyInvestigationHistoryRedirectPage() {
  redirect("/incidents");
}
