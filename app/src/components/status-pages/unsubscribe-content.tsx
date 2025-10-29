"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import {
  unsubscribeFromStatusPage,
  getSubscriberByToken,
} from "@/actions/unsubscribe-from-status-page";

export function UnsubscribeContent({ token }: { token: string }) {
  const [loadingState, setLoadingState] = useState<"loading" | "loaded" | "error">("loading");
  const [unsubscribeState, setUnsubscribeState] = useState<
    "pending" | "success" | "error" | "already_unsubscribed"
  >("pending");
  const [subscriber, setSubscriber] = useState<{
    id: string;
    email: string | null;
    statusPageId: string;
    purgeAt: Date | null;
    statusPage?: { name: string };
  } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadSubscriber = async () => {
      const result = await getSubscriberByToken(token);

      if (result.success && result.subscriber) {
        setSubscriber(result.subscriber);
        setLoadingState("loaded");

        // Check if already unsubscribed
        if (result.subscriber.purgeAt) {
          setUnsubscribeState("already_unsubscribed");
        }
      } else {
        setLoadingState("error");
      }
    };

    loadSubscriber();
  }, [token]);

  const handleUnsubscribe = async () => {
    setIsSubmitting(true);

    try {
      const result = await unsubscribeFromStatusPage(token);

      if (result.success) {
        if (result.alreadyUnsubscribed) {
          setUnsubscribeState("already_unsubscribed");
        } else {
          setUnsubscribeState("success");
        }
      } else {
        setUnsubscribeState("error");
      }
    } catch (error) {
      console.error("Error unsubscribing:", error);
      setUnsubscribeState("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingState === "loading") {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-16 w-16 text-muted-foreground mx-auto mb-4 animate-spin" />
        <h2 className="text-2xl font-semibold mb-2">Loading...</h2>
        <p className="text-muted-foreground">Please wait while we load your subscription details.</p>
      </div>
    );
  }

  if (loadingState === "error") {
    return (
      <div className="text-center py-12">
        <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Invalid Link</h2>
        <p className="text-muted-foreground mb-6">
          This unsubscribe link is invalid or has expired.
        </p>
        <Button asChild variant="outline">
          <Link href="/status-pages">Back to Status Pages</Link>
        </Button>
      </div>
    );
  }

  if (unsubscribeState === "success" || unsubscribeState === "already_unsubscribed") {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">
          {unsubscribeState === "success" ? "Successfully Unsubscribed" : "Already Unsubscribed"}
        </h2>
        <p className="text-muted-foreground mb-2">
          {subscriber?.email} will no longer receive notifications from this status page.
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          You can resubscribe at any time by visiting the status page.
        </p>
        {subscriber?.statusPageId && (
          <Button asChild variant="outline">
            <Link href={`/status/${subscriber.statusPageId}`}>
              View Status Page
            </Link>
          </Button>
        )}
      </div>
    );
  }

  if (unsubscribeState === "error") {
    return (
      <div className="text-center py-12">
        <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Unsubscribe Failed</h2>
        <p className="text-muted-foreground mb-6">
          An error occurred while unsubscribing. Please try again.
        </p>
        <Button onClick={handleUnsubscribe} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Retrying...
            </>
          ) : (
            "Try Again"
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="text-center mb-8">
        <Mail className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Unsubscribe from Updates</h2>
        <p className="text-muted-foreground">
          Are you sure you want to unsubscribe from notifications?
        </p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium mb-1">
              Subscription Details
            </p>
            <p className="text-muted-foreground">
              <strong>Email:</strong> {subscriber?.email}
            </p>
            {subscriber?.statusPage && (
              <p className="text-muted-foreground">
                <strong>Status Page:</strong> {subscriber.statusPage.name}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <Label htmlFor="feedback" className="text-base font-medium mb-2">
            Why are you unsubscribing? (Optional)
          </Label>
          <Textarea
            id="feedback"
            placeholder="Help us improve by letting us know why you're unsubscribing..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="min-h-[100px]"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Your feedback helps us improve our service.
          </p>
        </div>
      </div>

      <div className="flex gap-3 justify-center">
        <Button
          variant="destructive"
          onClick={handleUnsubscribe}
          disabled={isSubmitting}
          size="lg"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Unsubscribing...
            </>
          ) : (
            "Confirm Unsubscribe"
          )}
        </Button>
        {subscriber?.statusPageId && (
          <Button asChild variant="outline" size="lg">
            <Link href={`/status/${subscriber.statusPageId}`}>
              Keep Subscription
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
