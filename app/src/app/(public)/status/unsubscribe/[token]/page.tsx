import { Suspense } from "react";
import { UnsubscribeContent } from "@/components/status-pages/unsubscribe-content";

export const metadata = {
  title: "Unsubscribe",
  description: "Unsubscribe from status page notifications",
};

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white dark:bg-gray-900 rounded-lg shadow-sm border dark:border-gray-800 p-8">
        <Suspense fallback={<div>Loading...</div>}>
          <UnsubscribeContent token={token} />
        </Suspense>
      </div>
    </div>
  );
}
