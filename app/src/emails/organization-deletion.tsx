import { Button, Section, Text } from "@react-email/components";
import * as React from "react";
import { PALETTE } from "./palette";
import { BaseLayout } from "./base-layout";

export type OrganizationDeletionKind = "requested" | "reminder" | "completed" | "cancelled" | "projectDeleted";

interface OrganizationDeletionEmailProps {
  organizationName: string;
  kind: OrganizationDeletionKind;
  /** Purge date, formatted for display. */
  purgeDate?: string;
  daysRemaining?: number;
  /** Where the owner can cancel the deletion. */
  settingsUrl?: string;
  /** projectDeleted: the deleted project. */
  projectName?: string;
}

const copy = (kind: OrganizationDeletionKind, purgeDate: string, days: number, projectName = "") => {
  if (kind === "cancelled") {
    return {
      title: "Organization deletion cancelled",
      heading: "The deletion of your organization was cancelled",
      body: "An owner cancelled the deletion. The organization is active again, and its schedules and monitors resume.",
      cta: "Open organization",
    };
  }
  if (kind === "projectDeleted") {
    return {
      title: `Project deleted: ${projectName}`,
      heading: "A project was deleted",
      body: `The project ${projectName} was deleted and its monitors and schedules are stopped. An owner or admin can restore it from the organization page until ${purgeDate}. After that it is deleted permanently.`,
      cta: "Review deleted projects",
    };
  }
  if (kind === "requested") {
    return {
      title: "Organization scheduled for deletion",
      heading: "Your organization is scheduled for deletion",
      body: `Everything in it becomes read-only now and is permanently deleted on ${purgeDate}. Monitors and schedules are stopped. Until then an owner can cancel the deletion from the organization page.`,
      cta: "Review deletion",
    };
  }
  if (kind === "reminder") {
    return {
      title: `Deletion in ${days} ${days === 1 ? "day" : "days"}`,
      heading: `Your organization will be deleted in ${days} ${days === 1 ? "day" : "days"}`,
      body: `All data, reports and stored files are permanently deleted on ${purgeDate}. To keep the organization, cancel the deletion before then.`,
      cta: "Review deletion",
    };
  }
  return {
    title: "Organization deleted",
    heading: "Your organization has been deleted",
    body: "All of its data, reports and stored files were permanently deleted. This cannot be undone.",
    cta: "",
  };
};

export function organizationDeletionSubject(kind: OrganizationDeletionKind, organizationName: string, days = 0, projectName = ""): string {
  return `[Supercheck] ${copy(kind, "", days, projectName).title}${kind === "projectDeleted" ? "" : `: ${organizationName}`}`;
}

export const OrganizationDeletionEmail = ({
  organizationName = "Acme Corp",
  kind = "requested",
  purgeDate = "",
  daysRemaining = 7,
  settingsUrl,
  projectName,
}: OrganizationDeletionEmailProps) => {
  const text = copy(kind, purgeDate, daysRemaining, projectName);
  return (
    <BaseLayout preview={text.heading} title={kind === "projectDeleted" ? "Project deletion" : "Organization deletion"} headerColor={kind === "completed" || kind === "cancelled" ? PALETTE.info : PALETTE.warning}>
      <Section style={contentSection}>
        <Text style={heading}>{text.heading}</Text>
        <Text style={paragraph}><strong>{organizationName}</strong></Text>
        <Text style={paragraph}>{text.body}</Text>
        {settingsUrl && text.cta ? (
          <Section style={buttonContainer}>
            <Button style={button} href={settingsUrl}>{text.cta}</Button>
          </Section>
        ) : null}
      </Section>
    </BaseLayout>
  );
};

export default OrganizationDeletionEmail;

const contentSection = { padding: "32px 32px 0" };
const heading = { color: "#111827", fontSize: "24px", fontWeight: "700" as const, lineHeight: "1.3", margin: "0 0 16px", textAlign: "center" as const };
const paragraph = { color: "#4b5563", fontSize: "15px", lineHeight: "1.6", margin: "0 0 20px", textAlign: "center" as const };
const buttonContainer = { textAlign: "center" as const, margin: "8px 0 24px" };
const button = { backgroundColor: "#111827", borderRadius: "6px", color: "#ffffff", fontSize: "15px", fontWeight: "600" as const, padding: "12px 24px", textDecoration: "none" };
