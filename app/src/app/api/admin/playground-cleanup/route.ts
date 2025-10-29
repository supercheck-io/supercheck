import { NextResponse } from 'next/server';
import { getDataLifecycleService } from '@/lib/data-lifecycle-service';

/**
 * GET /api/admin/playground-cleanup - Get playground cleanup status
 */
export async function GET() {
  try {
    const lifecycleService = getDataLifecycleService();

    if (!lifecycleService) {
      return NextResponse.json({
        enabled: false,
        message: 'Data lifecycle service is not initialized'
      });
    }

    const status = await lifecycleService.getStatus();

    // Extract playground-specific status
    const playgroundEnabled = status.enabledStrategies.includes('playground_artifacts');
    const playgroundStats = status.stats.get('playground_artifacts');

    return NextResponse.json({
      success: true,
      status: {
        enabled: playgroundEnabled,
        stats: playgroundStats || { totalRecords: 0, oldRecords: 0 },
        queueStatus: status.queueStatus,
      },
    });
  } catch (error) {
    console.error('[API] Error getting playground cleanup status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get playground cleanup status',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/playground-cleanup - Trigger manual cleanup
 */
export async function POST() {
  try {
    const lifecycleService = getDataLifecycleService();

    if (!lifecycleService) {
      return NextResponse.json(
        {
          success: false,
          error: 'Data lifecycle service is not initialized'
        },
        { status: 503 }
      );
    }

    console.log('[API] Triggering manual playground cleanup...');
    const result = await lifecycleService.triggerManualCleanup('playground_artifacts');

    return NextResponse.json({
      success: result.success,
      message: 'Manual playground cleanup completed',
      result: {
        recordsDeleted: result.recordsDeleted,
        s3ObjectsDeleted: result.s3ObjectsDeleted || 0,
        duration: result.duration,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error('[API] Error triggering manual playground cleanup:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to trigger playground cleanup',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}