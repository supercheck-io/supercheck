import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { QueryProvider } from "@/lib/query-provider";
import { CheckIcon } from "@/components/logo/supercheck-logo";
import { SignOutButton } from "@/components/sign-out-button";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription | Supercheck",
  description: "Manage your subscription and billing information",
};

/**
 * Onboarding Layout - Clean layout without sidebar for subscription/setup flows
 * Used for billing page when user doesn't have an active subscription
 */
export default async function OnboardingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <QueryProvider>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
        {/* Header */}
        <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckIcon className="h-7 w-7" />
              <span className="font-semibold text-lg">Supercheck</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {session.user.email}
              </span>
              <SignOutButton variant="outline" size="sm" />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-8">{children}</main>

        {/* Footer */}
        <footer className="border-t bg-muted/30 mt-auto">
          <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
            <p>
              © {new Date().getFullYear()} Supercheck. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    </QueryProvider>
  );
}
