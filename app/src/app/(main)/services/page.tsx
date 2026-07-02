import { redirect } from "next/navigation";

export default function ServicesPage() {
  redirect("/org-admin?tab=services");
}
