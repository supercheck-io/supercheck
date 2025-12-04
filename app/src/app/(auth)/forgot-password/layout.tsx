import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot Password | Supercheck",
  description: "Reset your Supercheck account password",
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
