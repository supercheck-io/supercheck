import { liveJob, liveMonitor } from "@/lib/deletion/visibility";
import { NextResponse } from "next/server";
import { isAdminAccessDeniedError, requireAdmin } from '@/lib/admin';
import { adminDeniedResponse } from '@/lib/admin-errors';
import { getQueues } from '@/lib/queue';
import { db } from "@/utils/db";
import { jobs, monitors } from "@/db/schema";
import { and, isNotNull } from "drizzle-orm";

export async function GET() {
  try {
    // Require super admin privileges for scheduler status (security fix)
    await requireAdmin();

    // Get scheduler queue status
    const { jobSchedulerQueue, monitorSchedulerQueue } = await getQueues();
    
    // Get repeatable jobs from Redis
    const [jobRepeatableJobs, monitorRepeatableJobs] = await Promise.all([
      jobSchedulerQueue.getRepeatableJobs(),
      monitorSchedulerQueue.getRepeatableJobs()
    ]);

    // Get database scheduled entities
    const [scheduledJobs, scheduledMonitors] = await Promise.all([
      db.select({
        id: jobs.id,
        name: jobs.name,
        cronSchedule: jobs.cronSchedule,
        scheduledJobId: jobs.scheduledJobId,
        nextRunAt: jobs.nextRunAt
      }).from(jobs).where(and(isNotNull(jobs.cronSchedule), liveJob())),
      
      db.select({
        id: monitors.id,
        name: monitors.name,
        frequencyMinutes: monitors.frequencyMinutes,
        scheduledJobId: monitors.scheduledJobId,
        enabled: monitors.enabled
      }).from(monitors).where(and(isNotNull(monitors.frequencyMinutes), liveMonitor()))
    ]);

    const status = {
      redis: {
        jobRepeatableJobs: jobRepeatableJobs.length,
        monitorRepeatableJobs: monitorRepeatableJobs.length,
        totalRepeatableJobs: jobRepeatableJobs.length + monitorRepeatableJobs.length
      },
      database: {
        scheduledJobs: scheduledJobs.length,
        scheduledMonitors: scheduledMonitors.length,
        enabledMonitors: scheduledMonitors.filter(m => m.enabled).length
      },
      details: {
        jobs: scheduledJobs.map(job => ({
          id: job.id,
          name: job.name,
          cronSchedule: job.cronSchedule,
          hasSchedulerId: !!job.scheduledJobId,
          nextRunAt: job.nextRunAt
        })),
        monitors: scheduledMonitors.map(monitor => ({
          id: monitor.id,
          name: monitor.name,
          frequencyMinutes: monitor.frequencyMinutes,
          hasSchedulerId: !!monitor.scheduledJobId,
          enabled: monitor.enabled
        })),
        redisJobs: jobRepeatableJobs.map(job => ({
          id: job.id,
          name: job.name,
          key: job.key,
          pattern: job.pattern || 'N/A',
          next: job.next
        })),
        redisMonitors: monitorRepeatableJobs.map(job => ({
          id: job.id,
          name: job.name,
          key: job.key,
          every: job.every,
          next: job.next
        }))
      }
    };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      status
    });

  } catch (error: unknown) {
    const denied = adminDeniedResponse(error);
    if (denied) return denied;
    console.error('Scheduler status check error:', error);
    if (isAdminAccessDeniedError(error)) {
      return NextResponse.json(
        { success: false, error: 'Admin privileges required' },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to get scheduler status' },
      { status: 500 }
    );
  }
}
