"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { verifySubscriber } from "@/actions/verify-subscriber";

export function VerifySubscriberContent({ token }: { token: string }) {
  const [status, setStatus] = useState<
    "loading" | "success" | "error" | "already_verified"
  >("loading");
  const [message, setMessage] = useState("");
  const [statusPageId, setStatusPageId] = useState<string | null>(null);

  useEffect(() => {
    const verify = async () => {
      const result = await verifySubscriber(token);

      if (result.success) {
        if (result.alreadyVerified) {
          setStatus("already_verified");
        } else {
          setStatus("success");
        }
        setMessage(result.message);
        setStatusPageId(result.statusPageId || null);
      } else {
        setStatus("error");
        setMessage(result.message);
      }
    };

    verify();
  }, [token]);

  if (status === "loading") {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-16 w-16 text-muted-foreground mx-auto mb-4 animate-spin" />
        <h2 className="text-2xl font-semibold mb-2">
          Verifying your subscription...
        </h2>
        <p className="text-muted-foreground">
          Please wait while we verify your email address.
        </p>
      </div>
    );
  }

  if (status === "success" || status === "already_verified") {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">
          {status === "success" ? "Subscription Verified!" : "Already Verified"}
        </h2>
        <p className="text-muted-foreground mb-6">{message}</p>
        <p className="text-sm text-muted-foreground mb-6">
          You will now receive email notifications about incidents and updates.
        </p>
        {statusPageId && (
          <Button asChild>
            <Link href={`/status/${statusPageId}`}>View Status Page</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="text-center py-12">
      <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
      <h2 className="text-2xl font-semibold mb-2">Verification Failed</h2>
      <p className="text-muted-foreground mb-6">{message}</p>
      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6 max-w-md mx-auto">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-left">
            <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
              What can you do?
            </p>
            <ul className="text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside">
              <li>Try subscribing again with your email</li>
              <li>Check if you already verified your subscription</li>
              <li>Contact support if the problem persists</li>
            </ul>
          </div>
        </div>
      </div>
      <Button asChild variant="outline">
        <Link href="/status-pages">Back to Status Pages</Link>
      </Button>
    </div>
  );
}
