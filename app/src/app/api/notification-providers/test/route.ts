import { NextRequest, NextResponse } from "next/server";
import { type NotificationProviderConfig } from "@/db/schema";
import { EmailService } from "@/lib/email-service";
import { renderTestEmail } from "@/lib/email-renderer";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireAuthContext, isAuthError } from "@/lib/auth-context";
import {
  fetchSafeExternalUrl,
  validateWebhookUrlString,
} from "@/lib/url-validator";
import {
  normalizeWebhookMethod,
  renderWebhookJsonTemplate,
} from "@/lib/notification-providers/webhook-template";

const TEST_CONNECTION_TIMEOUT_MS = 10_000;

async function sendSafeConnectionTestRequest(url: string, init: RequestInit) {
  try {
    return await fetchSafeExternalUrl(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error(`Request timed out after ${TEST_CONNECTION_TIMEOUT_MS / 1000} seconds`);
    }

    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Require authentication and project context
    const context = await requireAuthContext();

    // PERFORMANCE: Use checkPermissionWithContext to avoid duplicate DB queries
    const canCreate = checkPermissionWithContext("notification", "create", context);

    if (!canCreate) {
      return NextResponse.json(
        {
          success: false,
          error: "Insufficient permissions to test connections",
        },
        { status: 403 }
      );
    }

    const { type, config } = await req.json();

    // Validate provider type
    const validTypes = ["email", "slack", "webhook", "telegram", "discord", "teams"];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: "Unsupported or missing provider type" },
        { status: 400 }
      );
    }

    switch (type) {
      case "email":
        return await testEmailConnection(config);
      case "slack":
        return await testSlackConnection(config);
      case "webhook":
        return await testWebhookConnection(config);
      case "telegram":
        return await testTelegramConnection(config);
      case "discord":
        return await testDiscordConnection(config);
      case "teams":
        return await testTeamsConnection(config);
      default:
        return NextResponse.json(
          { success: false, error: "Unsupported provider type" },
          { status: 400 }
        );
    }
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("Error testing connection:", error);
    return NextResponse.json(
      { success: false, error: "Failed to test connection" },
      { status: 500 }
    );
  }
}

async function testEmailConnection(config: NotificationProviderConfig) {
  try {
    // Validate emails field (new format)
    const typedConfig = config as Record<string, unknown>;
    if (!typedConfig.emails || !(typedConfig.emails as string).trim()) {
      throw new Error("At least one email address is required");
    }

    // Validate email format with length limit to prevent ReDoS
    const emailList = (typedConfig.emails as string)
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email);
    // Safer email regex without nested quantifiers - uses explicit character classes
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

    for (const email of emailList) {
      // RFC 5321 max email length is 254 characters
      if (email.length > 254) {
        throw new Error(`Email address too long: ${email.substring(0, 20)}...`);
      }
      if (!emailRegex.test(email)) {
        throw new Error(`Invalid email format: ${email}`);
      }
    }

    // Test SMTP connection — send to ALL configured addresses so users can verify
    const smtpResult = await testSMTPConnection(emailList);

    if (smtpResult.success) {
      return NextResponse.json({
        success: true,
        message: smtpResult.message || `Email connection successful via SMTP. Test email sent to ${emailList.length} recipient(s).`,
        details: smtpResult,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: `SMTP email connection failed: ${smtpResult.error}`,
          details: smtpResult,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Email connection failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 }
    );
  }
}

async function testSMTPConnection(
  testEmails: string[]
): Promise<{ success: boolean; message: string; error: string }> {
  try {
    const emailService = EmailService.getInstance();

    // Render email using react-email template
    const emailContent = await renderTestEmail({
      testMessage:
        "This is a test email to verify your SMTP configuration is working correctly.",
    });

    // Send sequentially via a single SMTP connection so all recipients are
    // reached even on servers that rate-limit concurrent connections
    const result = await emailService.sendEmailToMultiple({
      recipients: testEmails,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    // All failed — SMTP config is likely wrong
    if (result.sentCount === 0) {
      const firstError = Object.values(result.errors)[0] ?? "Send failed";
      return {
        success: false,
        message: "",
        error: `Failed to send to all ${testEmails.length} recipient(s): ${firstError}`,
      };
    }

    // Some succeeded, some failed — SMTP works but individual addresses may be bad
    if (result.failedAddresses.length > 0) {
      return {
        success: true,
        message: `SMTP connection verified. Sent to ${result.sentCount}/${testEmails.length} recipient(s). Failed for: ${result.failedAddresses.join(", ")}`,
        error: "",
      };
    }

    return {
      success: true,
      message: `Test email sent to ${testEmails.length} recipient(s)`,
      error: "",
    };
  } catch (error) {
    return {
      success: false,
      message: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testSlackConnection(config: NotificationProviderConfig) {
  try {
    const typedConfig = config as Record<string, unknown>;
    if (!typedConfig.webhookUrl) {
      throw new Error("Webhook URL is required");
    }

    const webhookUrl = typedConfig.webhookUrl as string;
    
    // Validate URL format and ensure it's not targeting internal networks
    const urlValidation = validateWebhookUrlString(webhookUrl);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.error || "Invalid webhook URL");
    }

    // Validate that the URL is a Slack webhook URL
    try {
      const parsedUrl = new URL(webhookUrl);
      // Only hooks.slack.com is the valid Slack webhook endpoint
      // Using exact match to prevent bypass via evil-hooks.slack.com
      if (parsedUrl.hostname !== 'hooks.slack.com') {
        throw new Error("URL must be a valid Slack webhook URL (hooks.slack.com)");
      }
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message.includes('Slack')) {
        throw parseError;
      }
      throw new Error("Invalid URL format");
    }

    const response = await sendSafeConnectionTestRequest(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "Test message from Supercheck - Connection test successful!",
        channel: typedConfig.channel,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return NextResponse.json({
      success: true,
      message: "Slack connection successful",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Slack connection failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 }
    );
  }
}

async function testWebhookConnection(config: NotificationProviderConfig) {
  try {
    const typedConfig = config as Record<string, unknown>;
    if (!typedConfig.url) {
      throw new Error("URL is required");
    }

    const targetUrl = typedConfig.url as string;
    const urlValidation = validateWebhookUrlString(targetUrl);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.error || "Invalid webhook URL");
    }

    const method = normalizeWebhookMethod(typedConfig.method);
    const headers = {
      "Content-Type": "application/json",
      ...(typedConfig.headers as Record<string, string>),
    };

    const hasBodyTemplate =
      typeof typedConfig.bodyTemplate === "string" &&
      typedConfig.bodyTemplate.trim().length > 0;

    const body =
      hasBodyTemplate && method !== "GET"
        ? renderWebhookJsonTemplate(
            typedConfig.bodyTemplate as string,
            {
              title: 'Test "Alert"',
              message: "Connection test from Supercheck",
              severity: "error",
              normalizedSeverity: "error",
              status: "down",
              monitorName: "Test Monitor",
              targetName: "Test Monitor",
              targetUrl: "https://example.com/health",
              targetId: "test-target-id",
              timestamp: "2025-01-15T10:30:00.000Z",
              type: "monitor_down",
              projectName: "Test Project",
              projectId: "test-project-id",
              responseTime: "5200",
              errorMessage: 'Connection timeout on "health" check',
              monitorType: "http_request",
              dashboardUrl: "https://app.supercheck.io/notification-monitor/test-target-id",
            },
          )
        : JSON.stringify({
            test: true,
            message: "Connection test from Supercheck",
          });

    try {
      const response = await sendSafeConnectionTestRequest(targetUrl, {
        method,
        headers,
        body: method === "GET" ? undefined : body,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return NextResponse.json({
        success: true,
        message: "Webhook connection successful",
      });
    } catch (fetchError) {
      throw fetchError;
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Webhook connection failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 }
    );
  }
}

async function testTelegramConnection(config: NotificationProviderConfig) {
  try {
    const typedConfig = config as Record<string, unknown>;
    if (!typedConfig.botToken || !typedConfig.chatId) {
      throw new Error("Bot token and chat ID are required");
    }

    // Sanitize bot token to prevent path traversal and SSRF
    const botToken = String(typedConfig.botToken).trim();
    
    // Validate bot token format (should be like 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)
    const botTokenRegex = /^[0-9]+:[A-Za-z0-9_-]+$/;
    if (!botTokenRegex.test(botToken)) {
      throw new Error("Invalid bot token format");
    }

    // Construct URL with validated token - only allow official Telegram API
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: typedConfig.chatId,
        text: "Test message from Supercheck - Connection test successful!",
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.description || `HTTP ${response.status}`);
    }

    return NextResponse.json({
      success: true,
      message: "Telegram connection successful",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Telegram connection failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 }
    );
  }
}

async function testDiscordConnection(config: NotificationProviderConfig) {
  try {
    const typedConfig = config as Record<string, unknown>;
    if (!typedConfig.discordWebhookUrl) {
      throw new Error("Discord webhook URL is required");
    }

    const webhookUrl = typedConfig.discordWebhookUrl as string;
    
    // Validate URL format and ensure it's not targeting internal networks
    const urlValidation = validateWebhookUrlString(webhookUrl);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.error || "Invalid webhook URL");
    }

    // Validate that the URL is a Discord webhook URL
    try {
      const parsedUrl = new URL(webhookUrl);
      const hostname = parsedUrl.hostname.toLowerCase();
      // Allowed Discord webhook hosts - exact match or legitimate subdomains
      const allowedDiscordHosts = [
        'discord.com',
        'discordapp.com',
        'canary.discord.com',
        'ptb.discord.com',
      ];
      if (!allowedDiscordHosts.includes(hostname)) {
        throw new Error("URL must be a valid Discord webhook URL (discord.com or discordapp.com)");
      }
      // Ensure it's specifically a webhook endpoint
      if (!parsedUrl.pathname.startsWith('/api/webhooks/')) {
        throw new Error("URL must be a Discord webhook endpoint (/api/webhooks/...)");
      }
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message.includes('Discord')) {
        throw parseError;
      }
      throw new Error("Invalid URL format");
    }

    const response = await sendSafeConnectionTestRequest(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Test message from Supercheck - Connection test successful!",
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return NextResponse.json({
      success: true,
      message: "Discord connection successful",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Discord connection failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 }
    );
  }
}

async function testTeamsConnection(config: NotificationProviderConfig) {
  try {
    const typedConfig = config as Record<string, unknown>;
    if (!typedConfig.teamsWebhookUrl) {
      throw new Error("Teams webhook URL is required");
    }

    const webhookUrl = typedConfig.teamsWebhookUrl as string;
    
    // Validate URL format and ensure it's not targeting internal networks
    const urlValidation = validateWebhookUrlString(webhookUrl);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.error || "Invalid webhook URL");
    }

    // Validate that the URL is a valid Microsoft Teams webhook URL
    // Supported formats (per Microsoft documentation):
    // - Power Automate: *.powerplatform.com
    // - Azure Logic Apps: *.logic.azure.com
    // - Legacy Connectors: *.webhook.office.com
    try {
      const parsedUrl = new URL(webhookUrl);
      const hostname = parsedUrl.hostname.toLowerCase();
      
      // Enforce HTTPS protocol
      if (parsedUrl.protocol !== 'https:') {
        throw new Error("Teams webhook URL must use HTTPS");
      }
      
      // Check against allowed Microsoft domains (shared constant)
      const { isValidTeamsWebhookDomain, getTeamsWebhookDomainError } = await import(
        "@/lib/notification-providers/constants"
      );
      
      if (!isValidTeamsWebhookDomain(hostname)) {
        throw new Error(getTeamsWebhookDomainError());
      }
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message.includes('webhook')) {
        throw parseError;
      }
      throw new Error("Invalid URL format");
    }

    // Build Adaptive Card test payload
    const adaptiveCardPayload = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: "✅ Supercheck Connection Test",
                weight: "bolder",
                size: "large",
                color: "good",
                wrap: true,
              },
              {
                type: "TextBlock",
                text: "This is a test message from Supercheck to verify your Microsoft Teams webhook is configured correctly.",
                wrap: true,
                spacing: "medium",
              },
              {
                type: "FactSet",
                facts: [
                  { title: "Status", value: "Connected Successfully" },
                  { title: "Provider", value: "Teams" },
                ],
                spacing: "medium",
              },
            ],
          },
        },
      ],
    };

    try {
      const response = await sendSafeConnectionTestRequest(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Supercheck-Monitor/1.0",
        },
        body: JSON.stringify(adaptiveCardPayload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return NextResponse.json({
        success: true,
        message: "Microsoft Teams connection successful",
      });
    } catch (fetchError) {
      throw fetchError;
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Microsoft Teams connection failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 }
    );
  }
}
