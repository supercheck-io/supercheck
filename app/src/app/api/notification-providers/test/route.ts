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
    const validTypes = ["email", "slack", "webhook", "telegram", "discord"];
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

    // Validate email format
    const emailList = (typedConfig.emails as string)
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const email of emailList) {
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

    const response = await fetch(typedConfig.webhookUrl as string, {
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

    const response = await fetch(typedConfig.url as string, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return NextResponse.json({
      success: true,
      message: "Webhook connection successful",
    });
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

    const url = `https://api.telegram.org/bot${typedConfig.botToken}/sendMessage`;
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

    const response = await fetch(typedConfig.discordWebhookUrl as string, {
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
