import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Invitation | Supercheck",
  description: "Accept your organization invitation",
};

export default function InviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
