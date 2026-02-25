import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { VerifySubscriberContent } from "@/components/status-pages/verify-subscriber-content";

export const metadata = {
  title: "Verify Subscription",
  description: "Verify your status page subscription",
};

export default async function VerifySubscriberPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white dark:bg-gray-900 rounded-lg shadow-sm border dark:border-gray-800 p-8">
        <Suspense fallback={<div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
          <VerifySubscriberContent token={token} />
        </Suspense>
      </div>
    </div>
  );
}
