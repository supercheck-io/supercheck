import { NextResponse } from "next/server";
import { requireAuth } from '@/lib/rbac/middleware';
import { initializeJobSchedulers, cleanupJobScheduler } from '@/lib/job-scheduler';
import { initializeMonitorSchedulers, cleanupMonitorScheduler } from '@/lib/monitor-scheduler';

export async function POST(request: Request) {
  try {
    // Require authentication for scheduler management
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'jobs', 'monitors', or 'all'
    
    const results: Record<string, unknown> = {};

    if (type === 'jobs' || type === 'all' || !type) {
      console.log('🔄 Manual job scheduler initialization started');
      try {
        await cleanupJobScheduler();
        const jobResult = await initializeJobSchedulers();
        results.jobs = jobResult;
        console.log(`✅ Job scheduler manual init: ${jobResult.initialized} succeeded, ${jobResult.failed} failed`);
      } catch (error) {
        console.error('❌ Manual job scheduler initialization failed:', error);
        results.jobs = { success: false, error: String(error) };
      }
    }

    if (type === 'monitors' || type === 'all' || !type) {
      console.log('🔄 Manual monitor scheduler initialization started');
      try {
        await cleanupMonitorScheduler();
        const monitorResult = await initializeMonitorSchedulers();
        results.monitors = monitorResult;
        console.log(`✅ Monitor scheduler manual init: ${monitorResult.scheduled} succeeded, ${monitorResult.failed} failed`);
      } catch (error) {
        console.error('❌ Manual monitor scheduler initialization failed:', error);
        results.monitors = { success: false, error: String(error) };
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Scheduler initialization triggered',
      results
    });

  } catch (error: unknown) {
    console.error('Manual scheduler initialization error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize schedulers' },
      { status: 500 }
    );
  }
}