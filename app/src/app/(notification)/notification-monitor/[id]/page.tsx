import { Metadata } from "next";
import { AlertCircle } from "lucide-react";
import { MonitorDetailClient, MonitorWithResults, MonitorResultItem } from "@/components/monitors/monitor-detail-client";
import { db } from "@/utils/db";
import { 
    monitors, 
    monitorResults, 
    projects,
    MonitorStatus as DBMoniotorStatusType, 
    MonitorType as DBMonitorType,
    MonitorResultStatus as DBMonitorResultStatusType,
    MonitorConfig
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/session";
import { getUserOrgRole, requireAuth } from "@/lib/rbac/middleware";

// Limit for chart data only - keep small for performance
const chartResultsLimit = 100;

type MonitorDetailsPageProps = {
  params: Promise<{
    id: string;
  }>;
};

// Direct server-side data fetching function
async function getMonitorDetailsDirectly(id: string): Promise<MonitorWithResults | null> {
  try {
    // Ensure user is authenticated
    await requireAuth();
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return null;
    }

    const monitorData = await db
      .select({
        id: monitors.id,
        name: monitors.name,
        target: monitors.target,
        type: monitors.type,
        enabled: monitors.enabled,
        frequencyMinutes: monitors.frequencyMinutes,
        status: monitors.status,
        createdAt: monitors.createdAt,
        updatedAt: monitors.updatedAt,
        lastCheckAt: monitors.lastCheckAt,
        config: monitors.config,
        alertConfig: monitors.alertConfig,
        projectId: monitors.projectId,
        organizationId: monitors.organizationId,
        projectName: projects.name,
      })
      .from(monitors)
      .leftJoin(projects, eq(monitors.projectId, projects.id))
      .where(eq(monitors.id, id))
      .limit(1);

    if (!monitorData || monitorData.length === 0) {
      return null; 
    }

    const monitor = monitorData[0];

    // Enforce organization membership for access
    if (monitor.organizationId) {
      const orgRole = await getUserOrgRole(currentUser.id, monitor.organizationId);
      if (!orgRole) {
        return null;
      }
    }

    const recentResultsData = await db
      .select()
      .from(monitorResults)
      .where(eq(monitorResults.monitorId, id))
      .orderBy(desc(monitorResults.checkedAt))
      .limit(chartResultsLimit);

    // Map DB results to MonitorResultItem structure for charts only
    const mappedRecentResults: MonitorResultItem[] = recentResultsData.map((r) => ({
      id: r.id,
      monitorId: r.monitorId,
      checkedAt: r.checkedAt ? new Date(r.checkedAt).toISOString() : new Date().toISOString(),
      status: r.status as DBMonitorResultStatusType,
      responseTimeMs: r.responseTimeMs,
      details: r.details,
      isUp: r.isUp,
      isStatusChange: r.isStatusChange,
      testExecutionId: r.testExecutionId ?? undefined,
      testReportS3Url: r.testReportS3Url ?? undefined,
      location: r.location ?? null,
    }));
    
    const frequencyMinutes = monitor.frequencyMinutes ?? 0;

    const transformedMonitor: MonitorWithResults = {
      id: monitor.id,
      name: monitor.name,
      url: monitor.target,
      target: monitor.target,
      type: monitor.type as DBMonitorType,
      enabled: monitor.enabled,
      frequencyMinutes,
      status: monitor.status as DBMoniotorStatusType,
      active: monitor.status !== 'paused',
      createdAt: monitor.createdAt ? new Date(monitor.createdAt).toISOString() : undefined,
      updatedAt: monitor.updatedAt ? new Date(monitor.updatedAt).toISOString() : undefined,
      lastCheckedAt: monitor.lastCheckAt ? new Date(monitor.lastCheckAt).toISOString() : undefined,
      responseTime: mappedRecentResults[0]?.responseTimeMs ?? undefined,
      uptime: undefined, 
      recentResults: mappedRecentResults,
      config: monitor.config as MonitorConfig,
      alertConfig: monitor.alertConfig || undefined,
      projectName: monitor.projectName || undefined,
    };

    return transformedMonitor;

  } catch (error) {
    console.error(`Error in getMonitorDetailsDirectly for ${id}:`, error);
    throw error;
  }
}

export async function generateMetadata({ params }: MonitorDetailsPageProps): Promise<Metadata> {
  const { id } = await params;
  const monitor = await getMonitorDetailsDirectly(id); 
  if (!monitor) {
    return {
      title: "Monitor Not Found | Supercheck",
    };
  }
  return {
    title: "Monitor Details | Supercheck",
    description: "Details and results for monitor",
  };
}

export default async function NotificationMonitorDetailsPage({ params }: MonitorDetailsPageProps) {
  const { id } = await params;
  try {
    const monitorWithData = await getMonitorDetailsDirectly(id);

    if (!monitorWithData) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <div className="flex flex-col items-center text-center">
            <AlertCircle className="h-16 w-16 text-amber-500 mb-4" />
            <h1 className="text-3xl font-bold mb-2">Monitor Not Found</h1>
            <p className="text-muted-foreground mb-6">
              This monitor is unavailable or you do not have access to view it.
            </p>
          </div>
        </div>
      );
    }
    
    return (
      <div className="w-full max-w-full">
        <MonitorDetailClient monitor={monitorWithData} isNotificationView={true} />
      </div>
    );
  } catch (error) {
    console.error("Error loading notification monitor:", error);
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="flex flex-col items-center text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
          <h1 className="text-3xl font-bold mb-2">Error Loading Monitor</h1>
          <p className="text-muted-foreground">
            Unable to load this monitor. It may not exist or you may not have permission to view it.
          </p>
        </div>
      </div>
    );
  }
}
