"use client";

import Link from "next/link";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
}: {
  error: Error & { digest?: string };
}) {
  // Log the error for debugging purposes
  console.error("Application error:", error);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="flex flex-col items-center text-center max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">
            Oops! Something went wrong
          </h1>
          <p className="text-muted-foreground text-lg">
            We encountered an unexpected error. Please try refreshing the page
            or return home.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
          <Link href="/" className="flex-1">
            <Button
              variant="outline"
              className="w-full flex items-center gap-2"
            >
              <Home className="h-4 w-4" />
              Go Home
            </Button>
          </Link>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-md">
          Error ID: {error.digest || "Unknown"}
        </div>
      </div>
    </div>
  );
}
