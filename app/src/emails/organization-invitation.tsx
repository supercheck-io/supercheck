import { Section, Text } from "@react-email/components";
import * as React from "react";
import { BaseLayout, Callout, DetailsTable, EmailButton, FallbackLink } from "./base-layout";

interface OrganizationInvitationEmailProps {
  inviteUrl: string;
  organizationName: string;
  role: string;
  projectInfo?: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  org_owner: "Organization owner",
  org_admin: "Organization admin",
  project_admin: "Project admin",
  project_editor: "Project editor",
  project_viewer: "Project viewer",
};

/** "PROJECT_EDITOR" / "project_editor" -> "Project editor". */
export const roleDisplayName = (role: string) => {
  const key = role.toLowerCase();
  const words = key.replace(/_/g, " ");
  return ROLE_LABELS[key] ?? words.charAt(0).toUpperCase() + words.slice(1);
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
      title={`Join ${organizationName} on Supercheck`}
      reason={`You received this because someone in ${organizationName} invited this address to Supercheck.`}
    >
      <Section style={contentSection}>
        <Text style={paragraph}>
          You have been invited to join <strong style={strong}>{organizationName}</strong> on Supercheck.
        </Text>
      </Section>

      <DetailsTable
        heading="Invitation"
        fields={[
          { title: "Organization", value: organizationName },
          { title: "Role", value: roleDisplayName(role) },
          ...(projectInfo ? [{ title: "Project access", value: projectInfo }] : []),
        ]}
      />

      <Section style={actionSection}>
        <Section style={buttonContainer}>
          <EmailButton href={inviteUrl}>Accept invitation</EmailButton>
        </Section>

        <FallbackLink href={inviteUrl} />

        <Callout
          tone="warning"
          title="This invitation expires in 7 days"
          lines={["If you did not expect this invitation, you can ignore this email."]}
        />
      </Section>
    </BaseLayout>
  );
};

const contentSection = {
  padding: "32px 32px 0",
};

const actionSection = {
  padding: "0 32px 32px",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 24px",
};

const strong = {
  color: "#111827",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "0 0 24px",
};

export default OrganizationInvitationEmail;
