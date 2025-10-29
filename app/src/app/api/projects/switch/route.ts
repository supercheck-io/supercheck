import { NextRequest, NextResponse } from 'next/server';
import { switchProject } from '@/lib/project-context';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    const result = await switchProject(projectId);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message,
        project: result.project
      });
    } else {
      return NextResponse.json(
        { error: result.message || 'Failed to switch project' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Failed to switch project:', error);
    
    if (error instanceof Error) {
      if (error.message === 'Authentication required') {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}