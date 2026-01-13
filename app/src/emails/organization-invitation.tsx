import {
  Button,
  Hr,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BaseLayout } from "./base-layout";

interface OrganizationInvitationEmailProps {
  inviteUrl: string;
  organizationName: string;
  role: string;
  projectInfo?: string;
}

export const OrganizationInvitationEmail = ({
  inviteUrl = "https://supercheck.io/invite/abc123",
  organizationName = "Acme Corp",
  role = "member",
  projectInfo = "",
}: OrganizationInvitationEmailProps) => {
  return (
    <BaseLayout
      preview={`You're invited to join ${organizationName} on Supercheck`}
      title="Team Invitation"
      headerColor="#16a34a" // Green-600
    >
      <Section style={contentSection}>
        {/* Main Content */}
        <Text style={heading}>You&apos;re Invited!</Text>

        <Text style={paragraph}>
          You&apos;ve been invited to join <strong>{organizationName}</strong> on
          Supercheck.
        </Text>

        <Section style={roleBox}>
          <Text style={roleLabel}>Your Role</Text>
          <Text style={roleValue}>{role.toUpperCase()}</Text>
        </Section>

        {projectInfo && (
          <Section style={infoBox}>
            <Text style={infoTitle}>Project Access</Text>
            <Text
              style={infoText}
              dangerouslySetInnerHTML={{ __html: projectInfo }}
            />
          </Section>
        )}

        <Text style={paragraph}>
          Click the button below to accept your invitation and get started:
        </Text>

        {/* CTA Button */}
        <Section style={buttonContainer}>
          <Button style={button} href={inviteUrl}>
            Accept Invitation
          </Button>
        </Section>

        <Hr style={hr} />

        {/* Expiry Notice */}
        <Section style={noticeBox}>
          <Text style={noticeText}>
            This invitation expires in <strong>7 days</strong>.
          </Text>
          <Text style={noticeText}>
            If you didn&apos;t expect this invitation, you can safely ignore this
            email.
          </Text>
        </Section>
      </Section>
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px 32px 0",
};

const heading = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  lineHeight: "1.3",
  margin: "0 0 24px",
  textAlign: "center" as const,
  letterSpacing: "-0.025em",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const roleBox = {
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  padding: "20px",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const roleLabel = {
  color: "#6b7280",
  fontSize: "12px",
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: "0 0 8px",
};

const roleValue = {
  color: "#111827",
  fontSize: "18px",
  fontWeight: "600" as const,
  margin: "0",
};

const infoBox = {
  backgroundColor: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  padding: "20px",
  margin: "0 0 24px",
};

const infoTitle = {
  color: "#1e293b",
  fontSize: "14px",
  fontWeight: "700" as const,
  margin: "0 0 12px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const infoText = {
  color: "#475569",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#16a34a",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 36px",
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "32px 0",
};

const noticeBox = {
  backgroundColor: "#fffbeb",
  border: "1px solid #fcd34d",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "0 0 32px",
};

const noticeText = {
  color: "#92400e",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "0 0 4px",
  textAlign: "center" as const,
};

export default OrganizationInvitationEmail;
