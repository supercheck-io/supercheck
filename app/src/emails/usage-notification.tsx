import {
  Button,
  Section,
  Text,
  Hr,
} from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface UsageNotificationEmailProps {
  organizationName: string;
  notificationType: 
    | "usage_50_percent"
    | "usage_80_percent"
    | "usage_90_percent"
    | "usage_100_percent"
    | "spending_limit_warning"
    | "spending_limit_reached";
  resourceType: "playwright" | "k6" | "combined" | "spending";
  usageAmount: number;
  usageLimit: number;
  usagePercentage: number;
  currentSpendingDollars?: number;
  spendingLimitDollars?: number;
  billingPageUrl: string;
  periodEndDate: string;
}

export const UsageNotificationEmail = ({
  organizationName,
  notificationType,
  resourceType,
  usageAmount,
  usageLimit,
  usagePercentage,
  currentSpendingDollars,
  spendingLimitDollars,
  billingPageUrl,
  periodEndDate,
}: UsageNotificationEmailProps) => {
  const getTitle = () => {
    switch (notificationType) {
      case "usage_50_percent":
        return "50% Usage Alert";
      case "usage_80_percent":
        return "80% Usage Warning";
      case "usage_90_percent":
        return "90% Usage Critical";
      case "usage_100_percent":
        return "Usage Limit Reached";
      case "spending_limit_warning":
        return "Spending Limit Warning";
      case "spending_limit_reached":
        return "Spending Limit Reached";
      default:
        return "Usage Notification";
    }
  };

  const getHeaderColor = () => {
    switch (notificationType) {
      case "usage_50_percent":
        return "#3b82f6"; // Blue
      case "usage_80_percent":
        return "#f59e0b"; // Amber
      case "usage_90_percent":
        return "#f97316"; // Orange
      case "usage_100_percent":
      case "spending_limit_reached":
        return "#ef4444"; // Red
      case "spending_limit_warning":
        return "#f59e0b"; // Amber
      default:
        return "#6b7280"; // Gray
    }
  };

  const getResourceLabel = () => {
    switch (resourceType) {
      case "playwright":
        return "Playwright Execution Minutes";
      case "k6":
        return "K6 Virtual User Hours";
      case "combined":
        return "Combined Usage";
      case "spending":
        return "Overage Spending";
      default:
        return "Usage";
    }
  };

  const getUnitLabel = () => {
    switch (resourceType) {
      case "playwright":
        return "minutes";
      case "k6":
        return "VU hours";
      default:
        return "units";
    }
  };

  const isSpendingNotification = notificationType.includes("spending");

  return (
    <BaseLayout
      preview={`${getTitle()} for ${organizationName}`}
      title={getTitle()}
      headerColor={getHeaderColor()}
    >
      <Section style={contentSection}>
        <Text style={greeting}>
          Hello,
        </Text>

        <Text style={paragraph}>
          This is an automated notification for <strong>{organizationName}</strong>.
        </Text>

        {isSpendingNotification ? (
          <>
            <Text style={paragraph}>
              Your overage spending has reached{" "}
              <strong style={{ color: getHeaderColor() }}>
                ${currentSpendingDollars?.toFixed(2)}
              </strong>{" "}
              of your{" "}
              <strong>${spendingLimitDollars?.toFixed(2)}</strong> monthly limit.
            </Text>

            {notificationType === "spending_limit_reached" && (
              <Text style={warningText}>
                ⚠️ Your spending limit has been reached. If you have hard stop enabled,
                new executions will be blocked until you increase your limit or the
                billing period resets.
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={paragraph}>
              Your <strong>{getResourceLabel()}</strong> usage has reached{" "}
              <strong style={{ color: getHeaderColor() }}>
                {usagePercentage}%
              </strong>{" "}
              of your included quota.
            </Text>

            <Section style={usageBox}>
              <Text style={usageLabel}>{getResourceLabel()}</Text>
              <Text style={usageValue}>
                {usageAmount.toLocaleString()} / {usageLimit.toLocaleString()} {getUnitLabel()}
              </Text>
              <Section style={progressBarContainer}>
                <Section
                  style={{
                    ...progressBar,
                    width: `${Math.min(usagePercentage, 100)}%`,
                    backgroundColor: getHeaderColor(),
                  }}
                />
              </Section>
            </Section>

            {notificationType === "usage_100_percent" && (
              <Text style={warningText}>
                ⚠️ You have exceeded your included quota. Additional usage will be
                billed at your plan&apos;s overage rate.
              </Text>
            )}
          </>
        )}

        <Text style={paragraph}>
          Your current billing period ends on <strong>{periodEndDate}</strong>.
        </Text>

        <Hr style={divider} />

        <Text style={paragraph}>
          To manage your usage limits, notification preferences, or upgrade your plan:
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={billingPageUrl}>
            View Billing Dashboard
          </Button>
        </Section>

        <Text style={tipText}>
          💡 <strong>Tip:</strong> You can set a monthly spending limit to control
          overage costs and receive notifications at custom thresholds.
        </Text>
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const contentSection = {
  padding: "32px 24px",
};

const greeting = {
  fontSize: "16px",
  lineHeight: "1.6",
  color: "#374151",
  margin: "0 0 16px",
};

const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#4b5563",
  margin: "0 0 16px",
};

const usageBox = {
  backgroundColor: "#f9fafb",
  borderRadius: "8px",
  padding: "20px",
  margin: "24px 0",
  border: "1px solid #e5e7eb",
};

const usageLabel = {
  fontSize: "12px",
  fontWeight: "600" as const,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 8px",
};

const usageValue = {
  fontSize: "24px",
  fontWeight: "700" as const,
  color: "#111827",
  margin: "0 0 12px",
};

const progressBarContainer = {
  backgroundColor: "#e5e7eb",
  borderRadius: "4px",
  height: "8px",
  overflow: "hidden" as const,
};

const progressBar = {
  height: "8px",
  borderRadius: "4px",
  transition: "width 0.3s ease",
};

const warningText = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#dc2626",
  backgroundColor: "#fef2f2",
  padding: "12px 16px",
  borderRadius: "6px",
  border: "1px solid #fecaca",
  margin: "16px 0",
};

const divider = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "24px 0",
};

const button = {
  backgroundColor: "#52c41a",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  padding: "12px 24px",
  display: "inline-block",
};

const tipText = {
  fontSize: "13px",
  lineHeight: "1.6",
  color: "#6b7280",
  backgroundColor: "#f0fdf4",
  padding: "12px 16px",
  borderRadius: "6px",
  border: "1px solid #bbf7d0",
  margin: "16px 0 0",
};

export default UsageNotificationEmail;
