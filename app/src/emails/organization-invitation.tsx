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
      title="You're Invited!"
      headerColor="linear-gradient(135deg, #10b981 0%, #059669 100%)"
    >
      <Text style={paragraph}>
        You&apos;ve been invited to join{" "}
        <strong style={{ color: "#1f2937" }}>{organizationName}</strong> as a{" "}
        <strong style={{ color: "#1f2937" }}>{role}</strong> on Supercheck.
      </Text>

      {projectInfo && (
        <Section style={infoBox}>
          <Text style={infoText}>
            <strong>Project Access:</strong>
          </Text>
          <Text style={infoText} dangerouslySetInnerHTML={{ __html: projectInfo }} />
        </Section>
      )}

      <Text style={paragraph}>
        Click the button below to accept your invitation and get started:
      </Text>

      <Section style={buttonContainer}>
        <Button style={button} href={inviteUrl}>
          Accept Invitation
        </Button>
      </Section>

      <Hr style={hr} />

      <Text style={smallText}>
        <strong>Note:</strong> This invitation expires in 7 days.
      </Text>

      <Text style={smallText}>
        If you didn&apos;t expect this invitation, you can safely ignore this email.
      </Text>
    </BaseLayout>
  );
};

const paragraph = {
  color: "#374151",
  fontSize: "16px",
  lineHeight: "1.5",
  margin: "0 0 24px",
};

const infoBox = {
  backgroundColor: "#f0fdf4",
  borderLeft: "4px solid #10b981",
  borderRadius: "4px",
  padding: "16px",
  margin: "24px 0",
};

const infoText = {
  color: "#166534",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 8px",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#10b981",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "32px 0 24px",
};

const smallText = {
  color: "#6b7280",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 12px",
};

export default OrganizationInvitationEmail;
