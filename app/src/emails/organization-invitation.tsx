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
      headerColor="linear-gradient(135deg, #10b981 0%, #059669 100%)"
    >
      {/* Icon */}
      <Section style={iconSection}>
        <div style={iconCircle}>
          <span style={iconEmoji}>👋</span>
        </div>
      </Section>

      {/* Main Content */}
      <Text style={heading}>You&apos;re Invited!</Text>

      <Text style={paragraph}>
        You&apos;ve been invited to join{" "}
        <strong style={orgName}>{organizationName}</strong> on Supercheck.
      </Text>

      <Section style={roleBox}>
        <Text style={roleLabel}>Your Role</Text>
        <Text style={roleValue}>{role.toUpperCase()}</Text>
      </Section>

      {projectInfo && (
        <Section style={infoBox}>
          <Text style={infoTitle}>📋 Project Access</Text>
          <Text style={infoText} dangerouslySetInnerHTML={{ __html: projectInfo }} />
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
          ⏱️ This invitation expires in <strong>7 days</strong>.
        </Text>
        <Text style={noticeText}>
          If you didn&apos;t expect this invitation, you can safely ignore this email.
        </Text>
      </Section>
    </BaseLayout>
  );
};

// ============================================================================
// ICON STYLES
// ============================================================================

const iconSection = {
  textAlign: "center" as const,
  marginBottom: "24px",
};

const iconCircle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "80px",
  height: "80px",
  borderRadius: "50%",
  backgroundColor: "#d1fae5",
  margin: "0 auto",
};

const iconEmoji = {
  fontSize: "40px",
  lineHeight: "1",
};

// ============================================================================
// TEXT STYLES
// ============================================================================

const heading = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: "700" as const,
  lineHeight: "1.3",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const orgName = {
  color: "#10b981",
  fontWeight: "600" as const,
};

// ============================================================================
// ROLE BOX STYLES
// ============================================================================

const roleBox = {
  backgroundColor: "#f0fdf4",
  borderRadius: "8px",
  padding: "16px",
  margin: "0 0 24px",
  textAlign: "center" as const,
};

const roleLabel = {
  color: "#065f46",
  fontSize: "12px",
  fontWeight: "700" as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0 0 4px",
};

const roleValue = {
  color: "#047857",
  fontSize: "18px",
  fontWeight: "700" as const,
  margin: "0",
};

// ============================================================================
// INFO BOX STYLES
// ============================================================================

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
};

const infoText = {
  color: "#475569",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};

// ============================================================================
// BUTTON STYLES
// ============================================================================

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#10b981",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "16px 40px",
  boxShadow: "0 4px 6px rgba(16, 185, 129, 0.25)",
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "32px 0",
};

// ============================================================================
// NOTICE BOX STYLES
// ============================================================================

const noticeBox = {
  backgroundColor: "#f0f9ff",
  borderLeft: "4px solid #3b82f6",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "0",
};

const noticeText = {
  color: "#1e40af",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 8px",
};

export default OrganizationInvitationEmail;
