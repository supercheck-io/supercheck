import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import * as React from "react";
import {
  PasswordResetEmail,
  OrganizationInvitationEmail,
  StatusPageVerificationEmail,
  StatusPageWelcomeEmail,
  IncidentNotificationEmail,
  MonitorAlertEmail,
  TestEmail,
} from "@/emails";

/**
 * Email Template Rendering API
 *
 * This endpoint renders email templates using react-email and returns both HTML and plain text versions.
 * It serves as the centralized source for all email templates across the app and worker services.
 *
 * Security: This endpoint should be protected in production. Options:
 * 1. Use an internal API key for worker-to-app communication
 * 2. Restrict to internal network only via firewall rules
 * 3. Use VPC/private network communication
 *
 * For now, we'll use a simple API key approach.
 */

// Type definitions for email template requests
type EmailTemplateType =
  | "password-reset"
  | "organization-invitation"
  | "status-page-verification"
  | "status-page-welcome"
  | "incident-notification"
  | "monitor-alert"
  | "test-email";

interface EmailRenderRequest {
  template: EmailTemplateType;
  data: Record<string, unknown>;
}

interface EmailRenderResponse {
  success: boolean;
  html?: string;
  text?: string;
  subject?: string;
  error?: string;
}

// Simple in-memory cache for rendered templates (optional, for performance)
const cache = new Map<string, { html: string; text: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(template: EmailTemplateType, data: Record<string, unknown>): string {
  return `${template}:${JSON.stringify(data)}`;
}

function getFromCache(key: string): { html: string; text: string } | null {
  const cached = cache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return { html: cached.html, text: cached.text };
}

function setCache(key: string, html: string, text: string): void {
  // Limit cache size
  if (cache.size > 100) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }

  cache.set(key, { html, text, timestamp: Date.now() });
}

/**
 * Verify API key for internal communication
 * In production, use a strong secret key stored in environment variables
 */
function verifyApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get("x-api-key");
  const expectedKey = process.env.EMAIL_API_KEY || "internal-email-service-key";

  // In development, allow requests without API key for testing
  if (process.env.NODE_ENV === "development" && !apiKey) {
    return true;
  }

  return apiKey === expectedKey;
}

export async function POST(request: NextRequest): Promise<NextResponse<EmailRenderResponse>> {
  try {
    // Verify API key
    if (!verifyApiKey(request)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body: EmailRenderRequest = await request.json();
    const { template, data } = body;

    if (!template) {
      return NextResponse.json(
        { success: false, error: "Template type is required" },
        { status: 400 }
      );
    }

    // Check cache first
    const cacheKey = getCacheKey(template, data);
    const cached = getFromCache(cacheKey);
    if (cached) {
      return NextResponse.json({
        success: true,
        html: cached.html,
        text: cached.text,
      });
    }

    let emailComponent: React.ReactElement;
    let subject: string | undefined;

    // Render the appropriate template
    switch (template) {
      case "password-reset":
        emailComponent = PasswordResetEmail({
          resetUrl: data.resetUrl as string,
          userEmail: data.userEmail as string,
        });
        subject = "Reset your Supercheck password";
        break;

      case "organization-invitation":
        emailComponent = OrganizationInvitationEmail({
          inviteUrl: data.inviteUrl as string,
          organizationName: data.organizationName as string,
          role: data.role as string,
          projectInfo: data.projectInfo as string | undefined,
        });
        subject = `You're invited to join ${data.organizationName} on Supercheck`;
        break;

      case "status-page-verification":
        emailComponent = StatusPageVerificationEmail({
          verificationUrl: data.verificationUrl as string,
          statusPageName: data.statusPageName as string,
        });
        subject = `Verify your subscription to ${data.statusPageName}`;
        break;

      case "status-page-welcome":
        emailComponent = StatusPageWelcomeEmail({
          statusPageName: data.statusPageName as string,
          statusPageUrl: data.statusPageUrl as string,
          unsubscribeUrl: data.unsubscribeUrl as string,
        });
        subject = `You're now subscribed to ${data.statusPageName}`;
        break;

      case "incident-notification":
        emailComponent = IncidentNotificationEmail({
          statusPageName: data.statusPageName as string,
          statusPageUrl: data.statusPageUrl as string,
          incidentName: data.incidentName as string,
          incidentStatus: data.incidentStatus as string,
          incidentImpact: data.incidentImpact as string,
          incidentDescription: data.incidentDescription as string,
          affectedComponents: (data.affectedComponents as string[]) || [],
          updateTimestamp: data.updateTimestamp as string,
          unsubscribeUrl: data.unsubscribeUrl as string,
        });
        subject = `[${(data.incidentStatus as string).toUpperCase()}] ${data.incidentName} - ${data.statusPageName}`;
        break;

      case "monitor-alert":
        emailComponent = MonitorAlertEmail({
          title: data.title as string,
          message: data.message as string,
          fields: (data.fields as Array<{ title: string; value: string }>) || [],
          footer: (data.footer as string) || "Supercheck Monitoring System",
          type: (data.type as "failure" | "success" | "warning") || "failure",
          color: (data.color as string) || "#dc2626",
        });
        subject = (data.title as string) || "Monitor Alert";
        break;

      case "test-email":
        emailComponent = TestEmail({
          testMessage: data.testMessage as string | undefined,
        });
        subject = "Test Email from Supercheck";
        break;

      default:
        return NextResponse.json(
          { success: false, error: `Unknown template type: ${template}` },
          { status: 400 }
        );
    }

    // Render to HTML and plain text
    const html = await render(emailComponent, { pretty: true });
    const text = await render(emailComponent, { plainText: true });

    // Cache the result
    setCache(cacheKey, html, text);

    return NextResponse.json({
      success: true,
      html,
      text,
      subject,
    });
  } catch (error) {
    console.error("Error rendering email template:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to render email template",
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: "ok",
    service: "email-template-renderer",
    templates: [
      "password-reset",
      "organization-invitation",
      "status-page-verification",
      "status-page-welcome",
      "incident-notification",
      "monitor-alert",
      "test-email",
    ],
  });
}
