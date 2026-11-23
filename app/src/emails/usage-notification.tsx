import { Section, Text } from "@react-email/components";
import * as React from "react";
import { PALETTE } from "./palette";
import { BaseLayout, Callout, EmailButton } from "./base-layout";

interface UsageNotificationEmailProps {
  organizationName: string;
  notificationType:
    | "usage_50_percent"
    | "usage_80_percent"
    | "usage_90_percent"
    | "usage_100_percent"
    | "spending_limit_warning"
    | "spending_limit_reached";
  resourceType: "playwright" | "k6" | "ai" | "sre" | "combined" | "spending";
  usageAmount: number;
  usageLimit: number;
  usagePercentage: number;
  currentSpendingDollars?: number;
  spendingLimitDollars?: number;
  /** The cap stops billable work at 100%; the email says what pauses. */
  hardStop?: boolean;
  billingPageUrl: string;
  /** End of the billing period, already formatted with a time zone; omitted when unknown. */
  periodEndDate?: string;
}

const TITLES: Record<UsageNotificationEmailProps["notificationType"], string> = {
  usage_50_percent: "Usage at 50% of your plan",
  usage_80_percent: "Usage at 80% of your plan",
  usage_90_percent: "Usage at 90% of your plan",
  usage_100_percent: "Included usage used up",
  spending_limit_warning: "Spending limit almost reached",
  spending_limit_reached: "Spending limit reached",
};

export const usageNotificationTitle = (type: UsageNotificationEmailProps["notificationType"]): string =>
  TITLES[type] ?? "Usage update";

export const UsageNotificationEmail = ({
  organizationName = "Acme Inc",
  notificationType = "usage_80_percent",
  resourceType = "playwright",
  usageAmount = 800,
  usageLimit = 1000,
  usagePercentage = 80,
  currentSpendingDollars,
  spendingLimitDollars,
  hardStop,
  billingPageUrl = "https://app.supercheck.io/billing",
  periodEndDate,
}: UsageNotificationEmailProps) => {
  const getTitle = () => usageNotificationTitle(notificationType);

  const filledPercent = Number.isFinite(usagePercentage)
    ? Math.round(Math.max(Math.min(usagePercentage, 100), 0))
    : 0;

  const getMeterColor = () => {
    switch (notificationType) {
      case "usage_50_percent":
        return PALETTE.info;
      case "usage_80_percent":
      case "spending_limit_warning":
        return PALETTE.warning;
      case "usage_90_percent":
      case "usage_100_percent":
      case "spending_limit_reached":
        return PALETTE.failure;
      default:
        return PALETTE.neutral;
    }
  };

  const getResourceLabel = () => {
    switch (resourceType) {
      case "playwright":
        return "Playwright execution minutes";
      case "k6":
        return "k6 virtual user minutes";
      case "ai":
        return "AI credits";
      case "sre":
        return "AI SRE investigation units";
      case "combined":
        return "Combined usage";
      case "spending":
        return "Overage spending";
      default:
        return "Usage";
    }
  };

  const getUnitLabel = () => {
    switch (resourceType) {
      case "playwright":
        return "minutes";
      case "k6":
        return "VU minutes";
      case "ai":
        return "credits";
      case "sre":
        return "investigations";
      default:
        return "units";
    }
  };

  const isSpendingNotification = notificationType.includes("spending");
  // A spending email needs both amounts; without them it falls back to the usage wording (never "$ of your $").
  const hasSpend =
    typeof currentSpendingDollars === "number" &&
    Number.isFinite(currentSpendingDollars) &&
    typeof spendingLimitDollars === "number" &&
    Number.isFinite(spendingLimitDollars);
  const hasUsage = Number.isFinite(usageLimit) && usageLimit > 0 && Number.isFinite(usageAmount);
  const periodText = periodEndDate ? ` (${periodEndDate})` : "";

  return (
    <BaseLayout
      preview={`${getTitle()} for ${organizationName}.${periodEndDate ? ` The billing period ends ${periodEndDate}.` : ""}`}
      title={getTitle()}
      reason="You received this because you manage billing for this organization."
      manage={{ href: billingPageUrl, label: "Manage usage limits and notifications" }}
    >
      <Section style={contentSection}>
        <Text style={paragraph}>
          <strong style={strong}>{organizationName}</strong>
        </Text>

        {isSpendingNotification && hasSpend ? (
          <>
            <Text style={paragraph}>
              Overage spending this billing period is <strong style={strong}>${currentSpendingDollars.toFixed(2)}</strong> of
              your <strong style={strong}>${spendingLimitDollars.toFixed(2)}</strong> monthly limit.
            </Text>

            {hardStop ? (
              <Callout
                tone={notificationType === "spending_limit_reached" ? "danger" : "warning"}
                lines={[
                  `${
                    notificationType === "spending_limit_reached"
                      ? "The limit is reached. New browser checks, test and job runs, k6 load tests and full AI SRE investigations are paused"
                      : "At the limit, new browser checks, test and job runs, k6 load tests and full AI SRE investigations will pause"
                  } until you raise the limit or the billing period resets${periodText}. HTTP, website, ping and port monitors keep running.`,
                ]}
              />
            ) : (
              notificationType === "spending_limit_reached" && (
                <Callout
                  tone="warning"
                  lines={["The limit is reached. Hard stop is off, so usage continues and is billed as overage."]}
                />
              )
            )}
          </>
        ) : (
          <>
            <Text style={paragraph}>
              {isSpendingNotification
                ? "Overage spending is close to or at your monthly limit."
                : <>Usage of <strong style={strong}>{getResourceLabel()}</strong> has reached{" "}
                  <strong style={strong}>{Math.round(usagePercentage)}%</strong> of your included quota.</>}
            </Text>

            {hasUsage && (
              <Section style={usageBox}>
                <Text style={usageLabel}>{getResourceLabel()}</Text>
                <Text style={usageValue}>
                  {usageAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} /{" "}
                  {usageLimit.toLocaleString("en-US", { maximumFractionDigits: 2 })} {getUnitLabel()}
                </Text>
                {/* A two-cell table: <Section> centres its table, which floated the fill. */}
                <table width="100%" cellPadding={0} cellSpacing={0} style={progressBarContainer}>
                  <tbody>
                    <tr>
                      <td
                        height={8}
                        width={`${filledPercent}%`}
                        style={{ ...progressBar, width: `${filledPercent}%`, backgroundColor: getMeterColor() }}
                      >
                        &nbsp;
                      </td>
                      {filledPercent < 100 ? (
                        <td height={8} style={progressBar}>
                          &nbsp;
                        </td>
                      ) : null}
                    </tr>
                  </tbody>
                </table>
              </Section>
            )}

            {notificationType === "usage_100_percent" && (
              <Callout
                tone="warning"
                lines={[
                  resourceType === "ai"
                    ? "All AI credits included in your plan are used. AI actions are unavailable until the next billing period starts or you upgrade your plan."
                    : "Your included quota is used. Further usage is billed at your plan's overage rate.",
                ]}
              />
            )}
          </>
        )}

        {periodEndDate && (
          <Text style={paragraph}>
            The current billing period ends on <strong style={strong}>{periodEndDate}</strong>.
          </Text>
        )}

        <Section style={buttonContainer}>
          <EmailButton href={billingPageUrl}>Open billing</EmailButton>
        </Section>

        <Text style={tipText}>
          You can set a monthly spending limit and choose the usage levels that send these emails on the billing
          page.
        </Text>
      </Section>
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px",
};

const paragraph = {
  fontSize: "15px",
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
  padding: "0",
  fontSize: "1px",
  lineHeight: "8px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "24px 0",
};

const tipText = {
  fontSize: "13px",
  lineHeight: "1.6",
  color: "#6b7280",
  margin: "16px 0 0",
  textAlign: "center" as const,
};

const strong = {
  color: "#111827",
};

export default UsageNotificationEmail;
