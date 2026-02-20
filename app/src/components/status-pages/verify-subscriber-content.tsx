"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { verifySubscriber } from "@/actions/verify-subscriber";
import { getTranslations } from "@/lib/status-page-translations";

export function VerifySubscriberContent({ token }: { token: string }) {
  const [status, setStatus] = useState<
    "loading" | "success" | "error" | "already_verified"
  >("loading");
  const [statusPageId, setStatusPageId] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("en");

  useEffect(() => {
    const verify = async () => {
      const result = await verifySubscriber(token);

      if (result.success) {
        if (result.alreadyVerified) {
          setStatus("already_verified");
        } else {
          setStatus("success");
        }
        setStatusPageId(result.statusPageId || null);
        if (result.language) {
          setLanguage(result.language);
        }
      } else {
        setStatus("error");
      }
    };

    verify();
  }, [token]);

  const t = getTranslations(language);

  if (status === "loading") {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-16 w-16 text-muted-foreground mx-auto mb-4 animate-spin" />
        <h2 className="text-2xl font-semibold mb-2">
          {t.verifyingSubscription}
        </h2>
        <p className="text-muted-foreground">
          {t.verifyPleaseWait}
        </p>
      </div>
    );
  }

  if (status === "success" || status === "already_verified") {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">
          {status === "success" ? t.subscriptionVerified : t.alreadyVerifiedTitle}
        </h2>
        <p className="text-muted-foreground mb-6">
          {status === "success" ? t.verificationSuccessDescription : t.alreadyVerifiedDescription}
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          {t.verifiedWillReceive}
        </p>
        {statusPageId && (
          <Button asChild>
            <Link href={`/status/${statusPageId}`}>{t.viewStatusPage}</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="text-center py-12">
      <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
      <h2 className="text-2xl font-semibold mb-2">{t.verificationFailed}</h2>
      <p className="text-muted-foreground mb-6">{t.verificationFailedDescription}</p>
      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6 max-w-md mx-auto">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-left">
            <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">
              {t.whatCanYouDo}
            </p>
            <ul className="text-amber-800 dark:text-amber-200 space-y-1 list-disc list-inside">
              <li>{t.trySubscribingAgain}</li>
              <li>{t.checkAlreadyVerified}</li>
              <li>{t.contactSupportPersists}</li>
            </ul>
          </div>
        </div>
      </div>
      <Button asChild variant="outline">
        <Link href="/status-pages">{t.backToStatusPages}</Link>
      </Button>
    </div>
  );
}
