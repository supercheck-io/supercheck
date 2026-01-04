"use server";

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { requireProjectContext } from "@/lib/project-context";
import { hasPermission } from "@/lib/rbac/middleware";
import { logAuditEvent } from "@/lib/audit-logger";
import { db } from "@/utils/db";
import { requirementDocuments, type RequirementDocumentType } from "@/db/schema";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3-proxy";
import { eq, sql } from "drizzle-orm";

const BUCKET_NAME = process.env.S3_REQUIREMENTS_BUCKET_NAME || "test-requirement-artifacts";

// ============================================================================
// TYPES
// ============================================================================

interface ExtractedRequirement {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high";
  tags?: string[];
}

interface ExtractResult {
  success: boolean;
  requirements?: ExtractedRequirement[];
  error?: string;
  documentName?: string;
  documentId?: string;
}

// ============================================================================
// FILE PARSING
// ============================================================================

/**
 * Extract text content from uploaded file
 */
async function extractTextFromFile(file: File): Promise<string> {
  const fileType = file.type;
  const fileName = file.name.toLowerCase();

  // Plain text / Markdown
  if (fileType === "text/plain" || fileType === "text/markdown" || fileName.endsWith(".md") || fileName.endsWith(".txt")) {
    return await file.text();
  }

  // PDF - extract via text layer (basic extraction)
  if (fileType === "application/pdf" || fileName.endsWith(".pdf")) {
    // For MVP, we'll send the file content as base64 and let the AI extract
    // In production, you'd use a PDF parsing library like pdf-parse
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `[PDF Document: ${file.name}]\n\nBase64 encoded PDF content provided. Please extract the text and identify requirements.\n\nPDF_BASE64:${base64.substring(0, 50000)}`; // Limit to ~37KB of PDF
  }

  // DOCX - basic text extraction (for MVP, rely on AI understanding)
  if (fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx")) {
    const buffer = await file.arrayBuffer();
    // Try to extract plain text from DOCX XML
    const text = await extractTextFromDocx(buffer);
    return text;
  }

  throw new Error(`Unsupported file type: ${fileType || fileName}`);
}

/**
 * Basic DOCX text extraction by parsing the XML
 */
async function extractTextFromDocx(buffer: ArrayBuffer): Promise<string> {
  try {
    // DOCX is a ZIP file with XML inside
    // For a full implementation, use 'mammoth' or 'docx' npm package
    // This is a simplified fallback that extracts readable text patterns
    const uint8Array = new Uint8Array(buffer);
    const textDecoder = new TextDecoder("utf-8", { fatal: false });
    const rawText = textDecoder.decode(uint8Array);

    // Extract text between XML tags (basic approach)
    const textMatches = rawText.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
    const extractedText = textMatches
      .map(match => match.replace(/<[^>]+>/g, ""))
      .join(" ");

    if (extractedText.length < 100) {
      return `[DOCX Document]\n\nUnable to fully parse DOCX. Please ensure the document contains readable text.\n\nPartial content: ${extractedText}`;
    }

    return extractedText;
  } catch {
    return "[DOCX Document]\n\nUnable to parse DOCX format. Please try converting to PDF or plain text.";
  }
}

// ============================================================================
// DOCUMENT STORAGE
// ============================================================================

function getFileType(filename: string): RequirementDocumentType {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'docx': return 'docx';
    case 'md': return 'md';
    case 'txt': return 'text';
    default: return 'text'; // Fallback to text
  }
}

async function uploadDocument(
  file: File,
  organizationId: string,
  projectId: string,
  userId: string
): Promise<{ id: string; storagePath: string }> {
  try {
    const s3 = getS3Client();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Generate unique storage path
    // Format: projects/{projectId}/documents/{timestamp}-{sanitized_filename}
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const storagePath = `projects/${projectId}/documents/${timestamp}-${sanitizedName}`;
    
    // Upload to S3
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storagePath,
      Body: buffer,
      ContentType: file.type || "application/octet-stream",
    }));

    // Create DB record
    const [doc] = await db.insert(requirementDocuments).values({
      organizationId,
      projectId,
      name: file.name,
      type: getFileType(file.name),
      storagePath,
      fileSize: file.size,
      uploadedByUserId: userId,
    }).returning();

    return { id: doc.id, storagePath };
  } catch (error) {
    console.error("Error uploading document:", error);
    throw new Error("Failed to store document: " + (error instanceof Error ? error.message : String(error)));
  }
}

async function deleteDocumentRecord(id: string) {
    try {
        await db.delete(requirementDocuments).where(eq(requirementDocuments.id, id));
    } catch (e) {
        console.error("Failed to cleanup document record", e);
    }
}

// ============================================================================
// AI EXTRACTION
// ============================================================================

const EXTRACTION_PROMPT = `You are a Senior QA Architect extracting TESTABLE requirements from product documentation.

YOUR GOAL: Transform documentation into precise, actionable requirements that can be directly used to create automated tests (Playwright, K6, API tests).

## OUTPUT FORMAT
For each requirement, provide:
1. **title**: Clean, concise summary (max 80 chars). NO prefixes like "API:", "UI:". Just the requirement itself.
   - ✅ GOOD: "User can reset password via email link"
   - ✅ GOOD: "Search returns results within 200ms"
   - ❌ BAD: "API: Password Reset Endpoint"
   - ❌ BAD: "UI: Search functionality"

2. **description**: Technical specification for testing (max 400 chars). Include:
   - Endpoints, methods, request/response formats
   - UI elements, interactions, expected states
   - Validation rules, error messages, edge cases
   - Performance thresholds if applicable

3. **priority**: "high" (core functionality, security), "medium" (standard features), or "low" (nice-to-have, edge cases)

4. **tags**: Array of 1-3 lowercase category tags from this list:
   - "api" - REST/GraphQL endpoints, HTTP operations
   - "ui" - User interface, forms, navigation, display
   - "auth" - Authentication, authorization, security
   - "data" - Database operations, data validation, CRUD
   - "integration" - Third-party services, webhooks, external systems
   - "performance" - Load testing, latency, throughput
   - "validation" - Input validation, form validation, error handling

## EXTRACTION RULES
1. **Be Specific**: Include actual values (200ms, 50 chars max, specific error messages)
2. **Be Testable**: Every requirement should answer "How do I verify this passed?"
3. **Ignore Fluff**: Skip marketing language, vague statements, and aspirational goals
4. **Consolidate**: Combine related items into single comprehensive requirements
5. **Technical Focus**: Extract the engineering specs, not the business pitch

## EXAMPLES
Example 1:
{
  "title": "User registration with email verification",
  "description": "POST /api/register accepts {email, password, name}. Password min 8 chars with 1 number. Returns 201 with userId. Sends verification email within 30s. Duplicate email returns 409.",
  "priority": "high",
  "tags": ["api", "auth", "validation"]
}

Example 2:
{
  "title": "File upload accepts PDF and DOCX only",
  "description": "Upload component (data-testid='file-upload') accepts .pdf and .docx under 10MB. Invalid files show 'Unsupported format' error. Progress bar shows during upload. Success shows filename in list.",
  "priority": "medium",
  "tags": ["ui", "validation"]
}

Example 3:
{
  "title": "Dashboard loads within 2 seconds",
  "description": "GET /api/dashboard must return complete data within 2000ms for users with up to 1000 items. Response includes user stats, recent activity (limit 10), and notifications.",
  "priority": "high",
  "tags": ["performance", "api"]
}

## DOCUMENT TO ANALYZE
{DOCUMENT_TEXT}

## RESPONSE
Respond ONLY with a valid JSON array:
[
  {"title": "...", "description": "...", "priority": "...", "tags": ["...", "..."]},
  ...
]`;

/**
 * Get the AI model based on environment configuration
 */
function getAIModel() {
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const modelName = process.env.AI_MODEL;

  switch (provider) {
    case "gemini":
      return google(modelName || "gemini-2.5-flash");
    case "anthropic":
      return anthropic(modelName || "claude-3-5-haiku-20241022");
    case "openai":
    default:
      return openai(modelName || "gpt-4o-mini");
  }
}

/**
 * Extract requirements from document text using AI
 */
async function extractWithAI(documentText: string): Promise<ExtractedRequirement[]> {
  // Limit document length to prevent token overflow
  const maxLength = 30000;
  const truncatedText = documentText.length > maxLength 
    ? documentText.substring(0, maxLength) + "\n\n[Document truncated due to length...]"
    : documentText;

  const prompt = EXTRACTION_PROMPT.replace("{DOCUMENT_TEXT}", truncatedText);

  const { text } = await generateText({
    model: getAIModel(),
    prompt,
    temperature: 0.3, // Lower temperature for more consistent extraction
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(60000), // 60 second timeout
  });

  // Parse JSON response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON array");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate and clean requirements
  const requirementSchema = z.object({
    title: z.string().min(5).max(500),
    description: z.string().max(2000).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    tags: z.array(z.string().max(30)).max(5).optional(),
  });

  const validated: ExtractedRequirement[] = [];
  for (const item of parsed) {
    try {
      const req = requirementSchema.parse(item);
      validated.push(req);
    } catch {
      // Skip invalid items
      console.warn("Skipping invalid requirement:", item);
    }
  }

  if (validated.length === 0) {
    throw new Error("No valid requirements could be extracted from the document");
  }

  return validated;
}

// ============================================================================
// SERVER ACTION
// ============================================================================

/**
 * Extract requirements from uploaded document using AI
 */
export async function extractRequirementsFromDocument(
  formData: FormData
): Promise<ExtractResult> {
  try {
    const { userId, project, organizationId } = await requireProjectContext();

    // Check create permission
    const canCreate = await hasPermission("requirement", "create", {
      organizationId,
      projectId: project.id,
    });

    if (!canCreate) {
      return {
        success: false,
        error: "Insufficient permissions to create requirements",
      };
    }

    // Get file from form data
    const file = formData.get("file") as File | null;
    if (!file) {
      return {
        success: false,
        error: "No file provided",
      };
    }

    // Validate file size
    const maxDocumentSizeBytes = parseInt(process.env.MAX_DOCUMENT_SIZE_MB || "10", 10) * 1024 * 1024;
    if (file.size > maxDocumentSizeBytes) {
      const maxMB = maxDocumentSizeBytes / (1024 * 1024);
      return {
        success: false,
        error: `File too large. Maximum size is ${maxMB}MB.`,
      };
    }

    // Check document count limit
    const maxDocsPerProject = parseInt(process.env.MAX_DOCUMENTS_PER_PROJECT || "100", 10);
    const docCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(requirementDocuments)
      .where(eq(requirementDocuments.projectId, project.id));
    
    const currentDocCount = docCountResult[0]?.count ?? 0;
    if (currentDocCount >= maxDocsPerProject) {
      return {
        success: false,
        error: `Maximum document limit reached (${maxDocsPerProject} documents per project). Please delete some documents before uploading new ones.`,
      };
    }

    // 1. Upload Document First
    let documentId: string;
    try {
      const uploadResult = await uploadDocument(file, organizationId, project.id, userId);
      documentId = uploadResult.id;
    } catch (uploadError) {
      return {
        success: false,
        error: "Failed to upload document: " + (uploadError instanceof Error ? uploadError.message : String(uploadError)),
      };
    }

    // 2. Extract text from file
    let documentText: string;
    try {
      documentText = await extractTextFromFile(file);
    } catch (textError) {
      await deleteDocumentRecord(documentId);
      return {
        success: false,
        error: "Failed to read document text: " + (textError instanceof Error ? textError.message : String(textError)),
      };
    }

    if (documentText.length < 50) {
      await deleteDocumentRecord(documentId);
      return {
        success: false,
        error: "Document appears to be empty or unreadable",
      };
    }

    // 3. Extract requirements using AI
    const requirements = await extractWithAI(documentText);

    // Log audit event
    await logAuditEvent({
      userId,
      action: "requirements_extracted",
      resource: "requirement",
      resourceId: file.name,
      metadata: {
        organizationId,
        projectId: project.id,
        projectName: project.name,
        documentName: file.name,
        documentId,
        documentType: file.type,
        documentSize: file.size,
        extractedCount: requirements.length,
      },
      success: true,
    });

    return {
      success: true,
      requirements,
      documentName: file.name,
      documentId,
    };
  } catch (error) {
    console.error("Error extracting requirements:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract requirements",
    };
  }
}
