import { getCachedAuthSession } from "@/lib/session-cache";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Auth | Supercheck",
  description: "Supercheck authentication",
};

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCachedAuthSession();

  if (session) {
    redirect("/");
  }

  return <AuthFrame>{children}</AuthFrame>;
}
