import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-center space-y-6 max-w-md mx-auto px-6">
        <div className="space-y-2">
          <AlertCircle className="h-16 w-16 text-gray-400 mx-auto" />
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
            Status Page Not Found
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            The status page you&#39;re looking for doesn&#39;t exist or has been
            removed.
          </p>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            If you believe this is an error, please contact the service
            provider&#39;s support team.
          </p>
        </div>

        <div className="text-xs text-gray-400 dark:text-gray-600">
          Powered by{" "}
          <a
            href="https://supercheck.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Supercheck
          </a>
        </div>
      </div>
    </div>
  );
}
