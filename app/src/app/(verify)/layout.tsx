import { getCachedAuthSession } from "@/lib/session-cache";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verify email | Supercheck",
  description: "Verify your Supercheck email address",
};

// Unlike (auth), a signed-in visitor whose email is not verified yet must reach /verify-email:
// sign-up and invitation acceptance both send them here with a session already set.
export default async function VerifyLayout({ children }: { children: React.ReactNode }) {
  const session = await getCachedAuthSession();
  if (session?.user?.emailVerified) redirect("/");
  return <div className="flex min-h-screen items-center justify-center">{children}</div>;
}
