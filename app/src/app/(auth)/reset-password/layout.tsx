import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password | Supercheck",
  description: "Reset your Supercheck account password",
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
