import { NextRequest, NextResponse } from 'next/server';
import { switchProject } from '@/lib/project-context';
import { requireSameOriginRequest } from '@/lib/security/same-origin';
import { z } from 'zod';

const schema = z.object({ projectId: z.string().uuid() }).strict();

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'A valid project ID is required' },
        { status: 400 }
      );
    }

    const result = await switchProject(parsed.data.projectId);

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
