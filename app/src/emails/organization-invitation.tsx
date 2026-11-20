import {
  Hr,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { BaseLayout, Callout, EmailButton } from "./base-layout";

interface OrganizationInvitationEmailProps {
  inviteUrl: string;
  organizationName: string;
  role: string;
  projectInfo?: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  org_owner: "Organization Owner",
  org_admin: "Organization Admin",
  project_admin: "Project Admin",
  project_editor: "Project Editor",
  project_viewer: "Project Viewer",
};

/** "PROJECT_EDITOR" / "project_editor" -> "Project Editor". */
export const roleDisplayName = (role: string) => {
  const key = role.toLowerCase();
  return (
    ROLE_LABELS[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
};

export const OrganizationInvitationEmail = ({
  inviteUrl = "https://supercheck.io/invite/abc123",
  organizationName = "Acme Corp",
  role = "project_viewer",
  projectInfo = "",
}: OrganizationInvitationEmailProps) => {
  return (
    <BaseLayout
      preview={`Join ${organizationName} as ${roleDisplayName(role)}. The invitation expires in 7 days.`}
      title="Team Invitation"
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
          <Text style={roleValue}>{roleDisplayName(role)}</Text>
        </Section>

        {projectInfo && (
          <Callout tone="neutral" title="Project Access" lines={[projectInfo]} />
        )}

        <Text style={paragraph}>
          Click the button below to accept your invitation and get started:
        </Text>

        {/* CTA Button */}
        <Section style={buttonContainer}>
          <EmailButton href={inviteUrl}>Accept Invitation</EmailButton>
        </Section>

        <Hr style={hr} />

        {/* Expiry Notice */}
        <Callout
          tone="warning"
          lines={[
            <>This invitation expires in <strong>7 days</strong>.</>,
            "If you didn't expect this invitation, you can safely ignore this email.",
          ]}
        />
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
  letterSpacing: "-0.025em",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 24px",
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

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};


const hr = {
  borderColor: "#e5e7eb",
  margin: "32px 0",
};

export default OrganizationInvitationEmail;
