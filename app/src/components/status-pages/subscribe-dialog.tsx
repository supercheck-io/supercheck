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
import { Loader2, CheckCircle2, Mail, Webhook, Slack, Rss, Copy } from "lucide-react";
import { subscribeToStatusPage } from "@/actions/subscribe-to-status-page";
import { toast } from "sonner";
import { maskWebhookEndpoint } from "@/lib/webhook-utils";
import Link from "next/link";

type SubscribeDialogProps = {
  statusPageId: string;
  statusPageName: string;
  trigger?: React.ReactNode;
};

type SubscriptionMode = "email" | "webhook" | "slack" | "rss";

export function SubscribeDialog({
  statusPageId,
  statusPageName,
  trigger,
}: SubscribeDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SubscriptionMode>("email");
  const [email, setEmail] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookDescription, setWebhookDescription] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const resetForm = () => {
    setEmail("");
    setWebhookUrl("");
    setWebhookDescription("");
    setSlackWebhookUrl("");
    setCopiedToClipboard(false);
    setIsSuccess(false);
  };

  const handleEmailSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast.error("Please enter your email address");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await subscribeToStatusPage({
        statusPageId,
        email,
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
        toast.error("Subscription failed", {
          description:
            result.message ||
            "Unable to complete subscription. Please try again.",
        });
      }
    } catch (error) {
      console.error("Error subscribing:", error);
      toast.error("Failed to subscribe", {
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWebhookSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!webhookUrl) {
      toast.error("Please enter your webhook URL");
      return;
    }

    // Basic URL validation
    try {
      new URL(webhookUrl);
    } catch {
      toast.error("Invalid webhook URL", {
        description: "Please enter a valid HTTP or HTTPS URL",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await subscribeToStatusPage({
        statusPageId,
        endpoint: webhookUrl,
        subscriptionMode: "webhook",
        description: webhookDescription,
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
          description:
            result.message ||
            "Unable to complete subscription. Please try again.",
        });
      }
    } catch (error) {
      console.error("Error subscribing:", error);
      toast.error("Failed to subscribe", {
        description: "An unexpected error occurred. Please try again.",
      });
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
      toast.error("Failed to copy to clipboard");
    }
  };

  const rssUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/status-pages/${statusPageId}/rss`;

  const handleSlackSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!slackWebhookUrl) {
      toast.error("Please enter your Slack webhook URL");
      return;
    }

    // Basic URL validation for Slack
    try {
      const url = new URL(slackWebhookUrl);
      if (!url.hostname.endsWith(".slack.com")) {
        toast.error("Invalid Slack webhook URL", {
          description: "URL must be from a slack.com domain (e.g., hooks.slack.com)",
        });
        return;
      }
    } catch {
      toast.error("Invalid webhook URL", {
        description: "Please enter a valid Slack webhook URL",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await subscribeToStatusPage({
        statusPageId,
        endpoint: slackWebhookUrl,
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
          description:
            result.message ||
            "Unable to complete subscription. Please try again.",
        });
      }
    } catch (error) {
      console.error("Error subscribing:", error);
      toast.error("Failed to subscribe", {
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || <Button>SUBSCRIBE TO UPDATES</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">
            Subscribe to Updates
          </DialogTitle>
        </DialogHeader>

        {isSuccess ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              Subscription Successful!
            </h3>
            <p className="text-muted-foreground">
              {mode === "email"
                ? "Please check your email to verify your subscription."
                : mode === "slack"
                ? "Your Slack channel will receive incident notifications."
                : "Your webhook will receive incident notifications."}
            </p>
          </div>
        ) : (
          <div className="w-full space-y-4">
            {/* Subscription Mode Tabs */}
            <Tabs
              value={mode}
              onValueChange={(value) => setMode(value as SubscriptionMode)}
            >
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="slack" className="flex items-center gap-2">
                  <Slack className="h-4 w-4" />
                  Slack
                </TabsTrigger>
                <TabsTrigger
                  value="webhook"
                  className="flex items-center gap-2"
                >
                  <Webhook className="h-4 w-4" />
                  Webhook
                </TabsTrigger>
                <TabsTrigger
                  value="rss"
                  className="flex items-center gap-2"
                >
                  <Rss className="h-4 w-4" />
                  RSS
                </TabsTrigger>
              </TabsList>

              {/* Email Subscription Tab */}
              <TabsContent value="email" className="space-y-4 mt-6">
                <div className="bg-muted/50 border border-border rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">
                    Get email notifications whenever{" "}
                    <strong>{statusPageName}</strong> creates, updates or
                    resolves an incident.
                  </p>
                </div>

                <form onSubmit={handleEmailSubscribe} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-base font-medium">
                      Email address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isSubmitting}
                      className="h-11"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      We&apos;ll send you a verification link before activating
                      your subscription.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11"
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

              {/* Slack Subscription Tab */}
              <TabsContent value="slack" className="space-y-4 mt-6">
                <div className="bg-muted/50 border border-border rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">
                    Send incident notifications directly to your Slack channel with rich formatting and action buttons.
                  </p>
                </div>

                <form onSubmit={handleSlackSubscribe} className="space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="slack-webhook-url"
                      className="text-base font-medium"
                    >
                      Slack Webhook URL
                    </Label>
                    <Input
                      id="slack-webhook-url"
                      type="url"
                      placeholder="https://hooks.slack.com/services/..."
                      value={slackWebhookUrl}
                      onChange={(e) => setSlackWebhookUrl(e.target.value)}
                      disabled={isSubmitting}
                      className="h-11 font-mono text-sm"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Get your webhook URL from Slack: Workspace Settings → Apps → Incoming Webhooks
                    </p>
                  </div>

                  <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-medium">
                      What you&apos;ll receive:
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>✓ Rich formatted messages with Block Kit</li>
                      <li>✓ Color-coded by incident impact</li>
                      <li>✓ Affected services and status updates</li>
                      <li>✓ Direct link to view full status page</li>
                    </ul>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                    <p className="text-xs text-blue-900 dark:text-blue-100">
                      <strong>How to set up:</strong><br/>
                      1. Go to your Slack workspace settings<br/>
                      2. Create an Incoming Webhook for your channel<br/>
                      3. Copy the webhook URL and paste it above
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Setting up Slack integration...
                      </>
                    ) : (
                      "SUBSCRIBE VIA SLACK"
                    )}
                  </Button>
                </form>
              </TabsContent>

              {/* Webhook Subscription Tab */}
              <TabsContent value="webhook" className="space-y-4 mt-6">
                <div className="bg-muted/50 border border-border rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">
                    Receive incident notifications as JSON webhooks. Perfect for
                    automation and integrations.
                  </p>
                </div>

                <form onSubmit={handleWebhookSubscribe} className="space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="webhook-url"
                      className="text-base font-medium"
                    >
                      Webhook URL
                    </Label>
                    <Input
                      id="webhook-url"
                      type="url"
                      placeholder="https://api.example.com/webhooks/incidents"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      disabled={isSubmitting}
                      className="h-11 font-mono text-sm"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      {webhookUrl && (
                        <>
                          Preview:{" "}
                          <code className="bg-muted px-2 py-1 rounded">
                            {maskWebhookEndpoint(webhookUrl)}
                          </code>
                        </>
                      )}
                      {!webhookUrl && "Must be a valid HTTPS URL"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="webhook-description"
                      className="text-base font-medium"
                    >
                      Description (optional)
                    </Label>
                    <Textarea
                      id="webhook-description"
                      placeholder="e.g., Production alerts webhook"
                      value={webhookDescription}
                      onChange={(e) => setWebhookDescription(e.target.value)}
                      disabled={isSubmitting}
                      className="resize-none"
                      rows={2}
                      maxLength={500}
                    />
                    <p className="text-xs text-muted-foreground">
                      {webhookDescription.length}/500 characters
                    </p>
                  </div>

                  <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
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
                    className="w-full h-11"
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
              {/* RSS Subscription Tab */}
              <TabsContent value="rss" className="space-y-4 mt-6">
                <div className="bg-muted/50 border border-border rounded-lg p-4">
                  <p className="text-sm text-muted-foreground">
                    Subscribe to the RSS feed to get real-time updates about incidents and status changes for{" "}
                    <strong>{statusPageName}</strong> in your favorite RSS reader.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-base font-medium">
                      RSS Feed URL
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={rssUrl}
                        readOnly
                        className="h-11 font-mono text-sm bg-muted/50"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleCopyToClipboard(rssUrl)}
                        className="h-11 w-11 flex-shrink-0"
                        title="Copy to clipboard"
                      >
                        {copiedToClipboard ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Click the copy button or select the URL above to copy it to your clipboard.
                    </p>
                  </div>

                  <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
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

                  <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                    <p className="text-xs text-blue-900 dark:text-blue-100">
                      <strong>How to use:</strong><br/>
                      1. Copy the RSS feed URL above<br/>
                      2. Add it to your favorite RSS reader (Feedly, Inoreader, etc.)<br/>
                      3. You&apos;ll receive instant updates for all incidents
                    </p>
                  </div>

                  <Link
                    href={rssUrl}
                    target="_blank"
                    className="block"
                  >
                    <Button
                      type="button"
                      className="w-full h-11"
                      variant="outline"
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
