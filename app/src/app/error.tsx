"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log the error for debugging purposes
  console.error("Application error:", error);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        <AlertCircle className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-3xl font-bold mb-2">Something went wrong</h1>
        <p className="text-muted-foreground mb-6">
          We encountered an unexpected error while processing your request.
        </p>

        <div className="flex gap-4">
          <Button onClick={() => reset()}>
            Try Again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Back to Home</Link>
          </Button>
        </div>

        {error.digest && (
          <div className="mt-8 text-xs text-muted-foreground bg-muted/30 px-3 py-2 rounded-md font-mono">
            Error ID: {error.digest}
          </div>
        )}
      </div>
    </div>
  );
}
