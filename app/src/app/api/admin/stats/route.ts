import { NextResponse } from 'next/server';
import { getSystemStats, requireAdmin } from '@/lib/admin';

export async function GET() {
  try {
    await requireAdmin();
    
    const stats = await getSystemStats();
    
    return NextResponse.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Admin stats GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch system statistics' },
      { status: error instanceof Error && error.message === 'Admin privileges required' ? 403 : 500 }
    );
  }
}