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
import { Loader2, CheckCircle2, Mail, Webhook } from "lucide-react";
import { subscribeToStatusPage } from "@/actions/subscribe-to-status-page";
import { toast } from "sonner";
import { maskWebhookEndpoint } from "@/lib/webhook-utils";

type SubscribeDialogProps = {
  statusPageId: string;
  statusPageName: string;
  trigger?: React.ReactNode;
};

type SubscriptionMode = "email" | "webhook";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const resetForm = () => {
    setEmail("");
    setWebhookUrl("");
    setWebhookDescription("");
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
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </TabsTrigger>
                <TabsTrigger
                  value="webhook"
                  className="flex items-center gap-2"
                >
                  <Webhook className="h-4 w-4" />
                  Webhook
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
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
