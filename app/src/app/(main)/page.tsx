import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { loadDashboardSeed } from "@/lib/dashboard/load-dashboard-seed";

export default function DashboardPage() {
  // Not awaited: the page streams immediately and the data follows in the same response.
  return <DashboardClient seed={loadDashboardSeed()} />;
}
