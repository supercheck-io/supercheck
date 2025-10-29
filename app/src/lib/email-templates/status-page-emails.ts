/**
 * Email templates for status page subscriptions
 */
import { getBaseDomain } from "@/lib/domain-utils";

type VerificationEmailParams = {
  email: string;
  statusPageName: string;
  verificationUrl: string;
};

export function getVerificationEmailTemplate(params: VerificationEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { statusPageName, verificationUrl } = params;

  const subject = `Verify your subscription to ${statusPageName}`;

  const text = `
Hello,

Thank you for subscribing to ${statusPageName} status updates!

Please verify your email address by clicking the link below:
${verificationUrl}

This link will expire in 24 hours.

If you did not request this subscription, you can safely ignore this email.

---
Powered by Supercheck
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Subscription</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 32px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                Verify Your Subscription
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.5;">
                Thank you for subscribing to <strong>${statusPageName}</strong> status updates!
              </p>

              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.5;">
                To complete your subscription and start receiving notifications about incidents and maintenance, please verify your email address:
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 32px 0;">
                <tr>
                  <td align="center">
                    <a href="${verificationUrl}" style="display: inline-block; padding: 14px 32px; background: #667eea; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                Or copy and paste this URL into your browser:<br>
                <a href="${verificationUrl}" style="color: #667eea; text-decoration: none; word-break: break-all;">
                  ${verificationUrl}
                </a>
              </p>

              <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0 0 12px; color: #6b7280; font-size: 14px; line-height: 1.5;">
                  <strong>Note:</strong> This verification link will expire in 24 hours.
                </p>
                <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.5;">
                  If you did not request this subscription, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; background: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">
                This email was sent because you subscribed to status updates from <strong>${statusPageName}</strong>.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                Powered by <a href="https://${getBaseDomain()}" style="color: #667eea; text-decoration: none;">Supercheck</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, text, html };
}

type WelcomeEmailParams = {
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
};

export function getWelcomeEmailTemplate(params: WelcomeEmailParams): {
  subject: string;
  text: string;
  html: string;
} {
  const { statusPageName, statusPageUrl, unsubscribeUrl } = params;

  const subject = `You're now subscribed to ${statusPageName}`;

  const text = `
Hello,

Your subscription to ${statusPageName} has been verified!

You will now receive email notifications about:
- Incidents and outages
- Scheduled maintenance
- Incident updates and resolutions

You can view the current status at any time: ${statusPageUrl}

To unsubscribe, click here: ${unsubscribeUrl}

---
Powered by Supercheck
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Confirmed</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 32px; text-align: center; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 8px 8px 0 0;">
              <div style="width: 48px; height: 48px; background: #ffffff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
                <span style="color: #10b981; font-size: 24px;">✓</span>
              </div>
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">
                You're All Set!
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 24px; color: #374151; font-size: 16px; line-height: 1.5;">
                Your subscription to <strong>${statusPageName}</strong> has been confirmed.
              </p>

              <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin: 24px 0; border-radius: 4px;">
                <p style="margin: 0 0 12px; color: #166534; font-size: 14px; font-weight: 600;">
                  You'll receive notifications for:
                </p>
                <ul style="margin: 0; padding-left: 20px; color: #166534; font-size: 14px; line-height: 1.6;">
                  <li>Service incidents and outages</li>
                  <li>Scheduled maintenance windows</li>
                  <li>Incident updates and resolutions</li>
                </ul>
              </div>

              <p style="margin: 24px 0 0; color: #374151; font-size: 16px; line-height: 1.5;">
                You can view the current status at any time:
              </p>

              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr>
                  <td align="center">
                    <a href="${statusPageUrl}" style="display: inline-block; padding: 12px 24px; background: #f3f4f6; color: #374151; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">
                      View Status Page
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; background: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">
                You're now subscribed to <strong>${statusPageName}</strong> status updates
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                <a href="${unsubscribeUrl}" style="color: #9ca3af; text-decoration: none;">Unsubscribe</a> • Powered by <a href="https://${getBaseDomain()}" style="color: #9ca3af; text-decoration: none;">Supercheck</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, text, html };
}

type IncidentNotificationEmailParams = {
  statusPageName: string;
  statusPageUrl: string;
  incidentName: string;
  incidentStatus: string;
  incidentImpact: string;
  incidentDescription: string;
  affectedComponents: string[];
  updateTimestamp: string;
  unsubscribeUrl: string;
};

export function getIncidentNotificationEmailTemplate(
  params: IncidentNotificationEmailParams
): {
  subject: string;
  text: string;
  html: string;
} {
  const {
    statusPageName,
    statusPageUrl,
    incidentName,
    incidentStatus,
    incidentImpact,
    incidentDescription,
    affectedComponents,
    updateTimestamp,
    unsubscribeUrl,
  } = params;

  // Determine colors based on impact
  const getImpactColors = (
    impact: string
  ): { bgColor: string; textColor: string; headerBg: string } => {
    switch (impact.toLowerCase()) {
      case "critical":
        return {
          bgColor: "#fef2f2",
          textColor: "#991b1b",
          headerBg: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
        };
      case "major":
        return {
          bgColor: "#fff7ed",
          textColor: "#92400e",
          headerBg: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
        };
      case "minor":
        return {
          bgColor: "#fffbeb",
          textColor: "#78350f",
          headerBg: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
        };
      default:
        return {
          bgColor: "#f3f4f6",
          textColor: "#374151",
          headerBg: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)",
        };
    }
  };

  const colors = getImpactColors(incidentImpact);

  const subject = `[${incidentStatus.toUpperCase()}] ${incidentName} - ${statusPageName}`;

  const text = `
${statusPageName} - Incident Notification

Incident: ${incidentName}
Status: ${incidentStatus}
Impact: ${incidentImpact}
Updated: ${updateTimestamp}

Description:
${incidentDescription}

${affectedComponents.length > 0 ? `Affected Services:\n${affectedComponents.map((c) => `- ${c}`).join("\n")}\n` : ""}
View full details: ${statusPageUrl}

---
Powered by Supercheck
  `.trim();

  const componentsHtml =
    affectedComponents.length > 0
      ? `
              <div style="margin: 24px 0; background: #f9fafb; padding: 16px; border-radius: 6px;">
                <p style="margin: 0 0 12px; color: #374151; font-weight: 600; font-size: 14px;">
                  Affected Services:
                </p>
                <ul style="margin: 0; padding-left: 20px; color: #6b7280; font-size: 14px; line-height: 1.6;">
                  ${affectedComponents.map((component) => `<li style="margin-bottom: 6px;">${component}</li>`).join("")}
                </ul>
              </div>
            `
      : "";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0; background-color: #f9fafb;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px; text-align: center; background: ${colors.headerBg}; border-radius: 8px 8px 0 0;">
              <div style="margin-bottom: 12px;">
                <span style="color: #ffffff; font-size: 32px;">⚠️</span>
              </div>
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 600;">
                ${statusPageName}
              </h1>
              <p style="margin: 8px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 14px;">
                Incident Notification
              </p>
            </td>
          </tr>

          <!-- Impact Badge -->
          <tr>
            <td style="padding: 24px 40px; border-bottom: 1px solid #e5e7eb;">
              <div style="display: inline-block; background: ${colors.bgColor}; color: ${colors.textColor}; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                ${incidentImpact} Impact
              </div>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 32px 40px;">
              <h2 style="margin: 0 0 24px; color: #1f2937; font-size: 20px; font-weight: 600;">
                ${incidentName}
              </h2>

              <div style="background: ${colors.bgColor}; border-left: 4px solid ${colors.textColor}; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding-right: 24px;">
                      <p style="margin: 0 0 8px; color: ${colors.textColor}; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                        Status
                      </p>
                      <p style="margin: 0; color: ${colors.textColor}; font-size: 16px; font-weight: 600;">
                        ${incidentStatus.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}
                      </p>
                    </td>
                    <td>
                      <p style="margin: 0 0 8px; color: ${colors.textColor}; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                        Updated
                      </p>
                      <p style="margin: 0; color: ${colors.textColor}; font-size: 14px;">
                        ${updateTimestamp}
                      </p>
                    </td>
                  </tr>
                </table>
              </div>

              <p style="margin: 0 0 16px; color: #374151; font-size: 15px; line-height: 1.6;">
                <strong>Description:</strong>
              </p>
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">
                ${incidentDescription}
              </p>

              ${componentsHtml}

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 32px 0 24px;">
                <tr>
                  <td align="center">
                    <a href="${statusPageUrl}" style="display: inline-block; padding: 14px 40px; background: #667eea; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                      View Full Status
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; color: #6b7280; font-size: 13px; text-align: center;">
                <a href="${statusPageUrl}" style="color: #667eea; text-decoration: none;">
                  View this incident and others on our status page
                </a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; background: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">
                Incident notification from <strong>${statusPageName}</strong> status page
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                <a href="${unsubscribeUrl}" style="color: #9ca3af; text-decoration: none;">Unsubscribe</a> • Powered by <a href="https://${getBaseDomain()}" style="color: #9ca3af; text-decoration: none;">Supercheck</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, text, html };
}
