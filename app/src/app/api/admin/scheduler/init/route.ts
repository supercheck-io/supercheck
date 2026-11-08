import { NextResponse } from "next/server";
import { requireAdmin } from '@/lib/admin';
import { adminDeniedResponse } from '@/lib/admin-errors';
import { initializeJobSchedulers, cleanupJobScheduler } from '@/lib/job-scheduler';
import { initializeMonitorSchedulers } from '@/lib/monitor-scheduler';

export async function POST(request: Request) {
  try {
    // Require super admin privileges for scheduler management (security fix)
    await requireAdmin();

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
    const denied = adminDeniedResponse(error);
    if (denied) return denied;
    console.error('Manual scheduler initialization error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize schedulers' },
      { status: 500 }
    );
  }
}