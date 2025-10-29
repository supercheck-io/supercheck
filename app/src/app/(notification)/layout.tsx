import { auth } from "@/utils/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function NotificationLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in?from=notification");
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="w-full px-8 py-4 max-w-screen-2xl mx-auto">
        {children}
      </main>
    </div>
  );
}
