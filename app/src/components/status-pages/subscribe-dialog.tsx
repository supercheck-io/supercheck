"use client";

import React, { useState } from "react";
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
  Copy,
} from "lucide-react";
import { subscribeToStatusPage } from "@/actions/subscribe-to-status-page";
import { toast } from "sonner";
import { maskWebhookEndpoint } from "@/lib/webhook-utils";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

type SubscribeDialogProps = {
  statusPageId: string;
  statusPageName: string;
  trigger?: React.ReactNode;
};

type SubscriptionMode = "email" | "webhook" | "slack" | "rss";

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const webhookSchema = z.object({
  webhookUrl: z
    .string()
    .url("Please enter a valid URL")
    .refine((url) => url.startsWith("https://"), "Webhook URL must use HTTPS"),
  webhookDescription: z.string().max(500, "Description too long").optional(),
});

const slackSchema = z.object({
  slackWebhookUrl: z
    .string()
    .url("Please enter a valid URL")
    .refine(
      (url) => url.includes(".slack.com"),
      "URL must be from a slack.com domain"
    ),
});

export function SubscribeDialog({
  statusPageId,
  statusPageName,
  trigger,
}: SubscribeDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SubscriptionMode>("email");
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  const webhookForm = useForm<z.infer<typeof webhookSchema>>({
    resolver: zodResolver(webhookSchema),
    defaultValues: { webhookUrl: "", webhookDescription: "" },
  });

  const slackForm = useForm<z.infer<typeof slackSchema>>({
    resolver: zodResolver(slackSchema),
    defaultValues: { slackWebhookUrl: "" },
  });

  const resetForm = () => {
    emailForm.reset();
    webhookForm.reset();
    slackForm.reset();
    setCopiedToClipboard(false);
    setIsSuccess(false);
  };

  const handleEmailSubscribe = async (data: z.infer<typeof emailSchema>) => {
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
        toast.success("Subscription successful!", {
          description: result.message,
        });
        setTimeout(() => {
          setOpen(false);
          resetForm();
        }, 3000);
      } else {
        toast.error("Subscription failed", { description: result.message });
      }
    } catch {
      toast.error("Failed to subscribe");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWebhookSubscribe = async (
    data: z.infer<typeof webhookSchema>
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
        toast.success("Webhook subscription successful!", {
          description: result.message,
        });
        setTimeout(() => {
          setOpen(false);
          resetForm();
        }, 3000);
      } else {
        toast.error("Webhook subscription failed", {
          description: result.message,
        });
      }
    } catch {
      toast.error("Failed to subscribe");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSlackSubscribe = async (data: z.infer<typeof slackSchema>) => {
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
        toast.success("Slack subscription successful!", {
          description: result.message,
        });
        setTimeout(() => {
          setOpen(false);
          resetForm();
        }, 3000);
      } else {
        toast.error("Slack subscription failed", {
          description: result.message,
        });
      }
    } catch {
      toast.error("Failed to subscribe");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedToClipboard(true);
      toast.success("RSS link copied to clipboard!");
      setTimeout(() => setCopiedToClipboard(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const rssUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/status-pages/${statusPageId}/rss`;
  const webhookUrl = webhookForm.watch("webhookUrl");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button>SUBSCRIBE TO UPDATES</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Subscribe to Updates
          </DialogTitle>
        </DialogHeader>

        {isSuccess ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              Subscription Successful!
            </h3>
            <p className="text-muted-foreground">
              {mode === "email"
                ? "Please check your email to verify your subscription."
                : mode === "slack"
                  ? "Your Slack channel will now receive incident notifications."
                  : "Your webhook endpoint will now receive incident notifications."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as SubscriptionMode)}
            >
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="email" className="gap-1.5">
                  <Mail className="h-4 w-4" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="slack" className="gap-1.5">
                  <Slack className="h-4 w-4" />
                  Slack
                </TabsTrigger>
                <TabsTrigger value="webhook" className="gap-1.5">
                  <Webhook className="h-4 w-4" />
                  Webhook
                </TabsTrigger>
                <TabsTrigger value="rss" className="gap-1.5">
                  <Rss className="h-4 w-4" />
                  RSS
                </TabsTrigger>
              </TabsList>

              {/* Email Tab */}
              <TabsContent value="email" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    Get email notifications whenever{" "}
                    <strong>{statusPageName}</strong> creates, updates, or
                    resolves an incident.
                  </p>
                </div>

                <form
                  onSubmit={emailForm.handleSubmit(handleEmailSubscribe)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium">
                      Email address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
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
                      We&apos;ll send you a verification link before activating
                      your subscription.
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
                        Subscribing...
                      </>
                    ) : (
                      "SUBSCRIBE VIA EMAIL"
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Slack Tab */}
              <TabsContent value="slack" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    Send incident notifications directly to your Slack channel
                    with rich formatting and action buttons.
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
                      Slack Webhook URL
                    </Label>
                    <Input
                      id="slack-webhook-url"
                      type="url"
                      placeholder="https://hooks.slack.com/services/..."
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

                  <div className="border bg-muted/30 rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      How to get your Slack Webhook URL:
                    </h4>
                    <ol className="text-xs space-y-1 list-decimal list-inside text-muted-foreground">
                      <li>
                        Go to{" "}
                        <a
                          href="https://api.slack.com/apps"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline font-medium"
                        >
                          api.slack.com/apps
                        </a>
                      </li>
                      <li>Create a new app or select an existing one</li>
                      <li>
                        Navigate to &quot;Incoming Webhooks&quot; in the sidebar
                      </li>
                      <li>
                        Toggle &quot;Activate Incoming Webhooks&quot; to On
                      </li>
                      <li>Click &quot;Add New Webhook to Workspace&quot;</li>
                      <li>Select the channel and copy the webhook URL</li>
                    </ol>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      What you&apos;ll receive:
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ Rich formatted messages</li>
                      <li>✓ Color-coded by incident impact</li>
                      <li>✓ Affected services and status updates</li>
                      <li>✓ Direct link to view full status page</li>
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
                        Setting up Slack...
                      </>
                    ) : (
                      "SUBSCRIBE VIA SLACK"
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Webhook Tab */}
              <TabsContent value="webhook" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    Receive incident notifications as JSON webhooks. Perfect for
                    automation and integrations.
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
                      Webhook URL
                    </Label>
                    <Input
                      id="webhook-url"
                      type="url"
                      placeholder="https://api.example.com/webhooks/incidents"
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
                        Preview:{" "}
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
                      Description (optional)
                    </Label>
                    <Textarea
                      id="webhook-description"
                      placeholder="e.g., Production alerts webhook"
                      {...webhookForm.register("webhookDescription")}
                      disabled={isSubmitting}
                      className="resize-none"
                      rows={2}
                    />
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      What you&apos;ll receive:
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ JSON payload with incident details</li>
                      <li>✓ Automatic retries on failure</li>
                      <li>✓ HMAC-SHA256 signature verification</li>
                      <li>✓ Event timestamps for tracking</li>
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
                        Setting up webhook...
                      </>
                    ) : (
                      "SUBSCRIBE VIA WEBHOOK"
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* RSS Tab */}
              <TabsContent value="rss" className="mt-5 space-y-4">
                <div className="bg-muted/50 border rounded-lg p-3">
                  <p className="text-sm text-muted-foreground">
                    Subscribe to the RSS feed to get real-time updates about
                    incidents for <strong>{statusPageName}</strong> in your
                    favorite RSS reader.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">RSS Feed URL</Label>
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
                        onClick={() => handleCopyToClipboard(rssUrl)}
                        className="h-10 w-10 flex-shrink-0"
                        title="Copy to clipboard"
                      >
                        {copiedToClipboard ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      What you&apos;ll receive:
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ Real-time incident notifications</li>
                      <li>✓ Status updates and resolutions</li>
                      <li>✓ Scheduled maintenance announcements</li>
                      <li>✓ Component status changes</li>
                    </ul>
                  </div>

                  <div className="bg-muted/30 border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">
                      <strong>How to use:</strong>
                      <br />
                      1. Copy the RSS feed URL above
                      <br />
                      2. Add it to your favorite RSS reader (Feedly, Inoreader,
                      etc.)
                      <br />
                      3. You&apos;ll receive instant updates for all incidents
                    </p>
                  </div>

                  <Link href={rssUrl} target="_blank" className="block">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10"
                    >
                      <Rss className="h-4 w-4 mr-2" />
                      Preview RSS Feed
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
