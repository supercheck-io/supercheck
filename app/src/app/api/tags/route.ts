import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/utils/db';
import { tags } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac/middleware';
import { requireProjectContext } from '@/lib/project-context';

export async function GET() {
  try {
    const { project, organizationId } = await requireProjectContext();
    
    // Check permission to view tags
    const canView = await hasPermission('tag', 'view', {
      organizationId,
      projectId: project.id
    });
    
    if (!canView) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Get tags scoped to the project
    const allTags = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.organizationId, organizationId),
        eq(tags.projectId, project.id)
      ))
      .orderBy(tags.name);

    return NextResponse.json(allTags);
  } catch (error) {
    console.error('Error fetching tags:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { project, organizationId, userId } = await requireProjectContext();

    const { name, color } = await request.json();
    
    // Check permission to create tags
    const canCreate = await hasPermission('tag', 'create', {
      organizationId,
      projectId: project.id
    });
    
    if (!canCreate) {
      return NextResponse.json(
        { error: 'Insufficient permissions to create tags' },
        { status: 403 }
      );
    }

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    }

    const trimmedName = name.trim();

    // Validate tag name
    if (!trimmedName) {
      return NextResponse.json({ error: 'Tag name cannot be empty' }, { status: 400 });
    }

    if (trimmedName.length < 3 || trimmedName.length > 20) {
      return NextResponse.json({ error: 'Tag name must be between 3 and 20 characters' }, { status: 400 });
    }

    if (/\s/.test(trimmedName)) {
      return NextResponse.json({ error: 'Tag name cannot contain spaces' }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      return NextResponse.json({ error: 'Tag name can only contain letters, numbers, underscores, and hyphens' }, { status: 400 });
    }



    // Check if tag already exists within the project
    const existingTag = await db
      .select()
      .from(tags)
      .where(and(
        eq(tags.name, trimmedName),
        eq(tags.organizationId, organizationId),
        eq(tags.projectId, project.id)
      ))
      .limit(1);

    if (existingTag.length > 0) {
      return NextResponse.json({ error: 'Tag already exists in this project' }, { status: 409 });
    }

    // Check if we've reached the maximum number of tags (50) per project
    const totalTags = await db
      .select({ count: tags.id })
      .from(tags)
      .where(and(
        eq(tags.organizationId, organizationId),
        eq(tags.projectId, project.id)
      ));

    if (totalTags.length >= 50) {
      return NextResponse.json({ error: 'Maximum of 50 tags allowed per project' }, { status: 400 });
    }

    // Generate a default color if not provided
    const defaultColors = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
      '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6B7280',
      '#14B8A6', '#F472B6', '#A78BFA', '#FB7185', '#FBBF24'
    ];
    const tagColor = color || defaultColors[Math.floor(Math.random() * defaultColors.length)];

    // Create the tag
    const [newTag] = await db
      .insert(tags)
      .values({
        name: trimmedName,
        color: tagColor,
        organizationId: organizationId,
        projectId: project.id,
        createdByUserId: userId,
      })
      .returning();

    return NextResponse.json(newTag, { status: 201 });
  } catch (error) {
    console.error('Error creating tag:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 