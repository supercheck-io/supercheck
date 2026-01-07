import { NextRequest, NextResponse } from "next/server";
import { type NotificationProviderConfig } from "@/db/schema";
import { EmailService } from "@/lib/email-service";
import { renderTestEmail } from "@/lib/email-renderer";
import { hasPermission } from "@/lib/rbac/middleware";
import { requireProjectContext } from "@/lib/project-context";

export async function POST(req: NextRequest) {
  try {
    // Require authentication and project context
    const { project, organizationId } = await requireProjectContext();

    // Check permission to create notification providers (test requires create permission)
    const canCreate = await hasPermission("monitor", "create", {
      organizationId,
      projectId: project.id,
    });

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

    // Test SMTP connection
    const smtpResult = await testSMTPConnection(emailList[0]);

    if (smtpResult.success) {
      return NextResponse.json({
        success: true,
        message: `Email connection successful via SMTP. Test email sent to ${emailList[0]}.`,
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
  testEmail: string
): Promise<{ success: boolean; message: string; error: string }> {
  try {
    // Use centralized EmailService
    const emailService = EmailService.getInstance();

    // Render email using react-email template
    const emailContent = await renderTestEmail({
      testMessage:
        "This is a test email to verify your SMTP configuration is working correctly.",
    });

    const result = await emailService.sendEmail({
      to: testEmail,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    return {
      success: result.success,
      message: result.message,
      error: result.error || "",
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

    // Validate URL to prevent SSRF attacks
    const { validateWebhookUrlString } = await import("@/lib/url-validator");
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

    const response = await fetch(webhookUrl, {
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

    const { validateWebhookUrlString } = await import("@/lib/url-validator");
    const urlValidation = validateWebhookUrlString(typedConfig.url as string);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.error || "Invalid webhook URL");
    }

    const method = (typedConfig.method as string) || "POST";
    const headers = {
      "Content-Type": "application/json",
      ...(typedConfig.headers as Record<string, string>),
    };

    const body = typedConfig.bodyTemplate
      ? (typedConfig.bodyTemplate as string).replace(
          /\{\{.*?\}\}/g,
          "test-value"
        )
      : JSON.stringify({
          test: true,
          message: "Connection test from Supercheck",
        });

    // Add timeout to prevent hanging connections
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(typedConfig.url as string, {
        method,
        headers,
        body: method !== "GET" ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return NextResponse.json({
        success: true,
        message: "Webhook connection successful",
      });
    } catch (fetchError) {
      clearTimeout(timeout);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error("Request timed out after 10 seconds");
      }
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

    // Validate URL to prevent SSRF attacks
    const { validateWebhookUrlString } = await import("@/lib/url-validator");
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

    const response = await fetch(webhookUrl, {
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

    // Use centralized SSRF protection validator (blocks private IPs, cloud metadata, etc.)
    const { validateWebhookUrlString } = await import("@/lib/url-validator");
    const urlValidation = validateWebhookUrlString(webhookUrl);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.error || "Invalid webhook URL");
    }

    // Parse URL for Teams-specific host validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      throw new Error("Invalid URL format");
    }

    // Enforce HTTPS protocol (redundant with validator but explicit for clarity)
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Teams webhook URL must use HTTPS");
    }

    const hostname = parsedUrl.hostname.toLowerCase();

    // Validate hostname - Teams webhooks must be from allowed Microsoft domains
    // Using strict allowlist approach for Teams-specific SSRF protection
    const allowedTeamsHosts = [
      "webhook.office.com",
      "outlook.office.com",
    ];
    const isValidTeamsHost = allowedTeamsHosts.some((allowedHost) => 
      hostname === allowedHost || hostname.endsWith("." + allowedHost)
    );
    
    if (!isValidTeamsHost) {
      throw new Error(
        "Invalid Teams webhook URL. Must point to a valid Microsoft Teams endpoint (webhook.office.com or outlook.office.com)"
      );
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
                  { title: "Provider", value: "Microsoft Teams" },
                ],
                spacing: "medium",
              },
            ],
          },
        },
      ],
    };

    // Add timeout to prevent hanging connections
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      // Use parsed URL to ensure consistent normalization after validation
      const response = await fetch(parsedUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Supercheck-Monitor/1.0",
        },
        body: JSON.stringify(adaptiveCardPayload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return NextResponse.json({
        success: true,
        message: "Microsoft Teams connection successful",
      });
    } catch (fetchError) {
      clearTimeout(timeout);
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        throw new Error("Request timed out after 10 seconds");
      }
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
