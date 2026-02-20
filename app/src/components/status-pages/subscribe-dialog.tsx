"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  CheckCircle2,
  Mail,
  Webhook,
  Slack,
  Rss,
  Calendar,
  CalendarDays,
  Copy,
} from "lucide-react";
import { subscribeToStatusPage } from "@/actions/subscribe-to-status-page";
import { toast } from "sonner";
import { maskWebhookEndpoint } from "@/lib/webhook-utils";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getTranslations, type TranslationKeys } from "@/lib/status-page-translations";

type SubscribeDialogProps = {
  statusPageId: string;
  statusPageName: string;
  language?: string;
  trigger?: React.ReactNode;
};

type SubscriptionMode = "email" | "webhook" | "slack" | "rss" | "ical";
type CopyTarget = "rss" | "ical";

const createEmailSchema = (t: TranslationKeys) =>
  z.object({
    email: z.string().email(t.validationInvalidEmail),
  });

const createWebhookSchema = (t: TranslationKeys) =>
  z.object({
    webhookUrl: z
      .string()
      .url(t.validationInvalidUrl)
      .refine((url) => url.startsWith("https://"), t.validationWebhookHttps),
    webhookDescription: z.string().max(500, t.validationDescriptionTooLong).optional(),
  });

const createSlackSchema = (t: TranslationKeys) =>
  z.object({
    slackWebhookUrl: z
      .string()
      .url(t.validationInvalidUrl)
      .refine(
        (url) => {
          try {
            const parsed = new URL(url);
            return parsed.hostname === 'hooks.slack.com';
          } catch {
            return false;
          }
        },
        t.validationInvalidSlackUrl
      ),
  });

export function SubscribeDialog({
  statusPageId,
  statusPageName,
  language = "en",
  trigger,
}: SubscribeDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SubscriptionMode>("email");
  const [copiedToClipboard, setCopiedToClipboard] = useState<CopyTarget | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const t = getTranslations(language);

  const emailSchema = createEmailSchema(t);
  const webhookSchema = createWebhookSchema(t);
  const slackSchema = createSlackSchema(t);

  const emailForm = useForm<z.infer<ReturnType<typeof createEmailSchema>>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  const webhookForm = useForm<z.infer<ReturnType<typeof createWebhookSchema>>>({
    resolver: zodResolver(webhookSchema),
    defaultValues: { webhookUrl: "", webhookDescription: "" },
  });

  const slackForm = useForm<z.infer<ReturnType<typeof createSlackSchema>>>({
    resolver: zodResolver(slackSchema),
    defaultValues: { slackWebhookUrl: "" },
  });

  const resetForm = () => {
    emailForm.reset();
    webhookForm.reset();
    slackForm.reset();
    setCopiedToClipboard(null);
    setIsSuccess(false);
  };

  const getFailureDescription = (
    message: string | undefined,
    fallbackDescription: string
  ) => {
    const normalizedMessage = message?.trim();
    return normalizedMessage ? normalizedMessage : fallbackDescription;
  };

  const handleEmailSubscribe = async (data: z.infer<ReturnType<typeof createEmailSchema>>) => {
    setIsSubmitting(true);
    try {
      const result = await subscribeToStatusPage({
        statusPageId,
        email: data.email,
        subscribeToAllComponents: true,
        subscriptionMode: "email",
      });

      if (result.success) {
        setIsSuccess(true);
        toast.success(t.toastSubscriptionSuccess, {
          description: t.toastSubscriptionSuccessDescription,
        });
        setTimeout(() => {
          setOpen(false);
          resetForm();
        }, 3000);
      } else {
        toast.error(t.toastSubscriptionFailed, {
          description: getFailureDescription(
            result.message,
            t.toastSubscriptionFailedDescription
          ),
        });
      }
    } catch {
      toast.error(t.toastFailedToSubscribe);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWebhookSubscribe = async (
    data: z.infer<ReturnType<typeof createWebhookSchema>>
  ) => {
    setIsSubmitting(true);
    try {
      const result = await subscribeToStatusPage({
        statusPageId,
        endpoint: data.webhookUrl,
        subscriptionMode: "webhook",
        description: data.webhookDescription,
        subscribeToAllComponents: true,
      });

      if (result.success) {
        setIsSuccess(true);
        toast.success(t.toastWebhookSuccess, {
          description: t.toastWebhookSuccessDescription,
        });
        setTimeout(() => {
          setOpen(false);
          resetForm();
        }, 3000);
      } else {
        toast.error(t.toastWebhookFailed, {
          description: getFailureDescription(
            result.message,
            t.toastWebhookFailedDescription
          ),
        });
      }
    } catch {
      toast.error(t.toastFailedToSubscribe);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSlackSubscribe = async (data: z.infer<ReturnType<typeof createSlackSchema>>) => {
    setIsSubmitting(true);
    try {
      const result = await subscribeToStatusPage({
        statusPageId,
        endpoint: data.slackWebhookUrl,
        subscriptionMode: "slack",
        subscribeToAllComponents: true,
      });

      if (result.success) {
        setIsSuccess(true);
        toast.success(t.toastSlackSuccess, {
          description: t.toastSlackSuccessDescription,
        });
        setTimeout(() => {
          setOpen(false);
          resetForm();
        }, 3000);
      } else {
        toast.error(t.toastSlackFailed, {
          description: getFailureDescription(
            result.message,
            t.toastSlackFailedDescription
          ),
        });
      }
    } catch {
      toast.error(t.toastFailedToSubscribe);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyToClipboard = async (
    text: string,
    target: CopyTarget,
    successMessage?: string
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToClipboard(target);
      toast.success(successMessage || t.toastRssCopied);
      setTimeout(() => setCopiedToClipboard(null), 2000);
    } catch {
      toast.error(t.toastFailedToCopy);
    }
  };

  const rssUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/status-pages/${statusPageId}/rss`;
  const icalUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/status-pages/${statusPageId}/ical`;
  const webhookUrl = webhookForm.watch("webhookUrl");
  const tabIconClassName = "h-4 w-4 shrink-0 stroke-[2.25]";
  const tabTriggerClassName =
    "h-10 min-w-0 justify-center gap-1.5 px-2 text-xs sm:text-sm data-[state=inactive]:text-foreground/80 data-[state=inactive]:opacity-100";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button>{t.subscribeToUpdates}</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {t.subscribeToUpdates}
          </DialogTitle>
        </DialogHeader>

        {isSuccess ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {t.subscriptionSuccess}
            </h3>
            <p className="text-muted-foreground">
              {mode === "email"
                ? t.checkEmailForVerification
                : mode === "slack"
                  ? t.slackChannelReceiveNotifications
                  : t.webhookReceiveNotifications}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as SubscriptionMode)}
            >
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/80 p-1 text-foreground sm:grid-cols-5">
                <TabsTrigger
                  value="email"
                  className={tabTriggerClassName}
                  title={t.email}
                >
                  <Mail className={tabIconClassName} />
                  <span className="truncate">{t.email}</span>
                </TabsTrigger>
                <TabsTrigger
                  value="slack"
                  className={tabTriggerClassName}
                  title={t.slack}
                >
                  <Slack className={tabIconClassName} />
                  <span className="truncate">{t.slack}</span>
                </TabsTrigger>
                <TabsTrigger
                  value="webhook"
                  className={tabTriggerClassName}
                  title={t.webhook}
                >
                  <Webhook className={tabIconClassName} />
                  <span className="truncate">{t.webhook}</span>
                </TabsTrigger>
                <TabsTrigger
                  value="rss"
                  className={tabTriggerClassName}
                  title={t.rssFeed}
                >
                  <Rss className={tabIconClassName} />
                  <span className="truncate">{t.rssFeed}</span>
                </TabsTrigger>
                <TabsTrigger
                  value="ical"
                  className={tabTriggerClassName}
                  title={t.calendarFeed}
                >
                  <Calendar className={tabIconClassName} />
                  <span className="truncate">{t.calendarFeed}</span>
                </TabsTrigger>
              </TabsList>

              {/* Email Tab */}
              <TabsContent value="email" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    {t.emailNotificationDescription}
                  </p>
                </div>

                <form
                  onSubmit={emailForm.handleSubmit(handleEmailSubscribe)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium">
                      {t.emailAddress}
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={t.enterYourEmail}
                      className="h-10"
                      {...emailForm.register("email")}
                      disabled={isSubmitting}
                    />
                    {emailForm.formState.errors.email && (
                      <p className="text-xs text-red-500">
                        {emailForm.formState.errors.email.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t.verificationNote}
                    </p>
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-10"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t.subscribing}
                      </>
                    ) : (
                      t.subscribeViaEmail
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Slack Tab */}
              <TabsContent value="slack" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    {t.slackNotificationDescription}
                  </p>
                </div>

                <form
                  onSubmit={slackForm.handleSubmit(handleSlackSubscribe)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label
                      htmlFor="slack-webhook-url"
                      className="text-sm font-medium"
                    >
                      {t.slackWebhookUrl}
                    </Label>
                    <Input
                      id="slack-webhook-url"
                      type="url"
                      placeholder={t.enterSlackWebhookUrl}
                      className="h-10 font-mono text-sm"
                      {...slackForm.register("slackWebhookUrl")}
                      disabled={isSubmitting}
                    />
                    {slackForm.formState.errors.slackWebhookUrl && (
                      <p className="text-xs text-red-500">
                        {slackForm.formState.errors.slackWebhookUrl.message}
                      </p>
                    )}
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      {t.whatYoullReceive}
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ {t.slackBenefitRichMessages}</li>
                      <li>✓ {t.slackBenefitColorCoded}</li>
                      <li>✓ {t.slackBenefitAffectedServices}</li>
                      <li>✓ {t.slackBenefitDirectLink}</li>
                    </ul>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">
                      <strong>{t.howToUse}</strong>
                      <br />
                      1. {t.slackStep1}{" "}
                      <a
                        href="https://api.slack.com/apps"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-medium"
                      >
                        api.slack.com/apps
                      </a>
                      <br />
                      2. {t.slackStep2}
                      <br />
                      3. {t.slackStep3}
                      <br />
                      4. {t.slackStep4}
                      <br />
                      5. {t.slackStep5}
                      <br />
                      6. {t.slackStep6}
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-10"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t.settingUpSlack}
                      </>
                    ) : (
                      t.subscribeViaSlack
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Webhook Tab */}
              <TabsContent value="webhook" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    {t.webhookNotificationDescription}
                  </p>
                </div>

                <form
                  onSubmit={webhookForm.handleSubmit(handleWebhookSubscribe)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label
                      htmlFor="webhook-url"
                      className="text-sm font-medium"
                    >
                      {t.webhookUrl}
                    </Label>
                    <Input
                      id="webhook-url"
                      type="url"
                      placeholder={t.enterWebhookUrl}
                      className="h-10 font-mono text-sm"
                      {...webhookForm.register("webhookUrl")}
                      disabled={isSubmitting}
                    />
                    {webhookForm.formState.errors.webhookUrl && (
                      <p className="text-xs text-red-500">
                        {webhookForm.formState.errors.webhookUrl.message}
                      </p>
                    )}
                    {webhookUrl && !webhookForm.formState.errors.webhookUrl && (
                      <p className="text-xs text-muted-foreground">
                        {t.preview}{" "}
                        <code className="bg-muted px-1.5 py-0.5 rounded">
                          {maskWebhookEndpoint(webhookUrl)}
                        </code>
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="webhook-description"
                      className="text-sm font-medium"
                    >
                      {t.webhookDescription} ({t.optionalDescription})
                    </Label>
                    <Textarea
                      id="webhook-description"
                      placeholder={t.webhookDescriptionPlaceholder}
                      {...webhookForm.register("webhookDescription")}
                      disabled={isSubmitting}
                      className="resize-none"
                      rows={2}
                    />
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      {t.whatYoullReceive}
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ {t.webhookBenefitJsonPayload}</li>
                      <li>✓ {t.webhookBenefitAutoRetries}</li>
                      <li>✓ {t.webhookBenefitSignatureVerification}</li>
                      <li>✓ {t.webhookBenefitEventTimestamps}</li>
                    </ul>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-10"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t.settingUpWebhook}
                      </>
                    ) : (
                      t.subscribeViaWebhook
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* RSS Tab */}
              <TabsContent value="rss" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    {t.rssNotificationDescription}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t.rssFeedUrl}</Label>
                    <div className="flex gap-2">
                      <Input
                        value={rssUrl}
                        readOnly
                        className="h-10 font-mono text-sm bg-muted/50"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleCopyToClipboard(rssUrl, "rss")}
                        className="h-10 w-10 flex-shrink-0"
                        title={t.copyToClipboard}
                      >
                        {copiedToClipboard === "rss" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      {t.whatYoullReceive}
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ {t.rssBenefitNotifications}</li>
                      <li>✓ {t.rssBenefitUpdates}</li>
                      <li>✓ {t.rssBenefitMaintenance}</li>
                      <li>✓ {t.rssBenefitComponentChanges}</li>
                    </ul>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">
                      <strong>{t.howToUse}</strong>
                      <br />
                      1. {t.rssStep1}
                      <br />
                      2. {t.rssStep2}
                      <br />
                      3. {t.rssStep3}
                    </p>
                  </div>

                  <Link href={rssUrl} target="_blank" className="block">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10"
                    >
                      <Rss className="h-4 w-4 mr-2" />
                      {t.previewRssFeed}
                    </Button>
                  </Link>
                </div>
              </TabsContent>

              {/* Calendar (iCal) Tab */}
              <TabsContent value="ical" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    {t.calendarNotificationDescription}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">{t.calendarFeedUrl}</Label>
                    <div className="flex gap-2">
                      <Input
                        value={icalUrl}
                        readOnly
                        className="h-10 font-mono text-sm bg-muted/50"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() =>
                          handleCopyToClipboard(
                            icalUrl,
                            "ical",
                            t.toastCalendarCopied
                          )
                        }
                        className="h-10 w-10 flex-shrink-0"
                        title={t.copyToClipboard}
                      >
                        {copiedToClipboard === "ical" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      {t.whatYoullReceive}
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ {t.calendarBenefitGoogleCalendar}</li>
                      <li>✓ {t.calendarBenefitAppleCalendar}</li>
                      <li>✓ {t.calendarBenefitOutlook}</li>
                      <li>✓ {t.calendarBenefitAutoSync}</li>
                    </ul>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">
                      <strong>{t.howToUse}</strong>
                      <br />
                      1. {t.calendarStep1}
                      <br />
                      2. {t.calendarStep2}
                      <br />
                      3. {t.calendarStep3}
                    </p>
                  </div>

                  <Link href={icalUrl} target="_blank" className="block">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10"
                    >
                      <CalendarDays className="h-4 w-4 mr-2" />
                      {t.previewCalendarFeed}
                    </Button>
                  </Link>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
