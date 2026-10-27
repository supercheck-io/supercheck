import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Notifications | Supercheck",
  description: "Manage the channels that receive alerts and incident updates",
};

export default function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
