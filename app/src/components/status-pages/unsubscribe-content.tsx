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
import { getTranslations } from "@/lib/status-page-translations";

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
    statusPage?: { name: string; language?: string | null };
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

  const t = getTranslations(subscriber?.statusPage?.language || "en");

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
        <h2 className="text-2xl font-semibold mb-2">{t.loading}</h2>
        <p className="text-muted-foreground">{t.pleaseWait}</p>
      </div>
    );
  }

  if (loadingState === "error") {
    return (
      <div className="text-center py-12">
        <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">{t.invalidUnsubscribeLink}</h2>
        <p className="text-muted-foreground mb-6">
          {t.invalidUnsubscribeLinkDescription}
        </p>
        <Button asChild variant="outline">
          <Link href="/status-pages">{t.returnToStatusPage}</Link>
        </Button>
      </div>
    );
  }

  if (unsubscribeState === "success" || unsubscribeState === "already_unsubscribed") {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">
          {unsubscribeState === "success" ? t.successfullyUnsubscribed : t.alreadyUnsubscribed}
        </h2>
        <p className="text-muted-foreground mb-2">
          {subscriber?.email} {t.unsubscribeNoLongerReceive}
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          {t.unsubscribeResubscribeAnytime}
        </p>
        {subscriber?.statusPageId && (
          <Button asChild variant="outline">
            <Link href={`/status/${subscriber.statusPageId}`}>
              {t.viewStatusPage}
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
        <h2 className="text-2xl font-semibold mb-2">{t.unsubscribeError}</h2>
        <p className="text-muted-foreground mb-6">
          {t.unsubscribeErrorDescription}
        </p>
        <Button onClick={handleUnsubscribe} disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {t.unsubscribing}
            </>
          ) : (
            t.unsubscribe
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="text-center mb-8">
        <Mail className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">{t.unsubscribeFromUpdates}</h2>
        <p className="text-muted-foreground">
          {t.unsubscribeConfirmation}
        </p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium mb-1">
              {t.subscriptionDetailsTitle}
            </p>
            <p className="text-muted-foreground">
              <strong>{t.emailLabel}</strong> {subscriber?.email}
            </p>
            {subscriber?.statusPage && (
              <p className="text-muted-foreground">
                <strong>{t.statusPageLabel}</strong> {subscriber.statusPage.name}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <Label htmlFor="feedback" className="text-base font-medium mb-2">
            {t.feedback}
          </Label>
          <Textarea
            id="feedback"
            placeholder={t.feedbackPlaceholder}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="min-h-[100px]"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t.feedbackHelperText}
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
              {t.unsubscribing}
            </>
          ) : (
            t.unsubscribe
          )}
        </Button>
        {subscriber?.statusPageId && (
          <Button asChild variant="outline" size="lg">
            <Link href={`/status/${subscriber.statusPageId}`}>
              {t.returnToStatusPage}
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
