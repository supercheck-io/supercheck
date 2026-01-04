"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  type NotificationProviderType,
  type NotificationProviderConfig,
} from "@/db/schema";
import {
  getUserFriendlyError,
  VALIDATION_PATTERNS,
  CHARACTER_LIMITS,
} from "@/lib/error-utils";
import { notificationProviders } from "@/components/alerts/data";

const notificationProviderSchema = z
  .object({
    type: z.enum(["email", "slack", "webhook", "telegram", "discord", "teams"] as const),
    config: z.object({
      name: z.string().min(1, "Name is required"),

      // Email fields - simplified to just email addresses
      emails: z
        .string()
        .max(
          CHARACTER_LIMITS.emails,
          `Email addresses cannot exceed ${CHARACTER_LIMITS.emails} characters`
        )
        .optional()
        .refine(
          (emails) => {
            if (!emails?.trim()) return true; // Optional field

            // Split by comma and validate each email
            const emailList = emails.split(",").map((email) => email.trim());

            return emailList.every(
              (email) => email === "" || VALIDATION_PATTERNS.email.test(email)
            );
          },
          {
            message: "Please enter valid email addresses separated by commas",
          }
        ),

      // Slack fields
      webhookUrl: z
        .string()
        .optional()
        .refine(
          (url) => {
            if (!url) return true;
            return VALIDATION_PATTERNS.slackWebhook.test(url);
          },
          {
            message: "Please enter a valid Slack webhook URL",
          }
        ),
      channel: z
        .string()
        .optional()
        .refine(
          (channel) => {
            if (!channel) return true;
            return VALIDATION_PATTERNS.slackChannel.test(channel);
          },
          {
            message:
              "Channel must start with # and contain only lowercase letters, numbers, hyphens, and underscores",
          }
        ),

      // Webhook fields
      url: z
        .string()
        .optional()
        .refine(
          (url) => {
            if (!url) return true;
            try {
              new URL(url);
              return VALIDATION_PATTERNS.httpUrl.test(url);
            } catch {
              return false;
            }
          },
          {
            message: "Please enter a valid HTTP or HTTPS URL",
          }
        ),
      method: z.enum(["GET", "POST", "PUT"]).optional(),
      headers: z.record(z.string()).optional(),
      bodyTemplate: z
        .string()
        .max(
          CHARACTER_LIMITS.bodyTemplate,
          `Body template cannot exceed ${CHARACTER_LIMITS.bodyTemplate} characters`
        )
        .optional(),

      // Telegram fields
      botToken: z
        .string()
        .optional()
        .refine(
          (token) => {
            if (!token) return true;
            return VALIDATION_PATTERNS.telegramBotToken.test(token);
          },
          {
            message:
              "Please enter a valid Telegram bot token (format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)",
          }
        ),
      chatId: z
        .string()
        .optional()
        .refine(
          (chatId) => {
            if (!chatId) return true;
            return VALIDATION_PATTERNS.telegramChatId.test(chatId);
          },
          {
            message:
              "Please enter a valid chat ID (numeric value, may start with -)",
          }
        ),

      // Discord fields
      discordWebhookUrl: z
        .string()
        .optional()
        .refine(
          (url) => {
            if (!url) return true;
            return VALIDATION_PATTERNS.discordWebhook.test(url);
          },
          {
            message: "Please enter a valid Discord webhook URL",
          }
        ),

      // Teams fields
      teamsWebhookUrl: z
        .string()
        .optional()
        .refine(
          (url) => {
            if (!url) return true;
            return VALIDATION_PATTERNS.teamsWebhook.test(url);
          },
          {
            message: "Please enter a valid Microsoft Teams webhook URL",
          }
        ),
    }),
  })
  .refine(
    (data) => {
      // Validate required fields based on type
      if (data.type === "email") {
        const emails = data.config.emails?.trim();
        return emails && emails.length > 0;
      }
      if (data.type === "slack") {
        return data.config.webhookUrl;
      }
      if (data.type === "webhook") {
        return data.config.url;
      }
      if (data.type === "telegram") {
        return data.config.botToken && data.config.chatId;
      }
      if (data.type === "discord") {
        return data.config.discordWebhookUrl;
      }
      if (data.type === "teams") {
        return data.config.teamsWebhookUrl;
      }
      return true;
    },
    {
      message: "Required fields are missing for the selected provider type",
    }
  );

const MASKED_FIELD_LABELS: Record<string, string> = {
  webhookUrl: "Webhook URL",
  url: "Target URL",
  headers: "Headers",
  botToken: "Bot Token",
  discordWebhookUrl: "Discord Webhook URL",
  teamsWebhookUrl: "Teams Webhook URL",
};

type FormValues = z.infer<typeof notificationProviderSchema>;

interface NotificationProviderFormProps {
  onSuccess?: (data: FormValues) => void;
  onCancel?: () => void;
  initialData?: {
    type: NotificationProviderType;
    config: NotificationProviderConfig;
    maskedFields?: string[];
  };
  defaultType?: NotificationProviderType;
}

export function NotificationProviderForm({
  onSuccess,
  onCancel,
  initialData,
  defaultType,
}: NotificationProviderFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const maskedFields = initialData?.maskedFields ?? [];
  const friendlyMaskedFields = maskedFields.map(
    (field) => MASKED_FIELD_LABELS[field] ?? field
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(notificationProviderSchema),
    mode: "onSubmit", // Only validate on submit, not on every change
    defaultValues: initialData
      ? {
        type: initialData.type,
        config: {
          name:
            ((initialData.config as Record<string, unknown>)
              .name as string) || "",
          emails:
            ((initialData.config as Record<string, unknown>)
              .emails as string) || "",
          webhookUrl:
            ((initialData.config as Record<string, unknown>)
              .webhookUrl as string) || "",
          channel:
            ((initialData.config as Record<string, unknown>)
              .channel as string) || "",
          url:
            ((initialData.config as Record<string, unknown>).url as string) ||
            "",
          method:
            ((initialData.config as Record<string, unknown>).method as
              | "GET"
              | "POST"
              | "PUT") || "POST",
          headers:
            ((initialData.config as Record<string, unknown>)
              .headers as Record<string, string>) || {},
          bodyTemplate:
            ((initialData.config as Record<string, unknown>)
              .bodyTemplate as string) || "",
          botToken:
            ((initialData.config as Record<string, unknown>)
              .botToken as string) || "",
          chatId:
            ((initialData.config as Record<string, unknown>)
              .chatId as string) || "",
          discordWebhookUrl:
            ((initialData.config as Record<string, unknown>)
              .discordWebhookUrl as string) || "",
          teamsWebhookUrl:
            ((initialData.config as Record<string, unknown>)
              .teamsWebhookUrl as string) || "",
        },
      }
      : {
        type: defaultType || "email",
        config: {
          name: "",
          emails: "",
          webhookUrl: "",
          channel: "",
          url: "",
          method: "POST",
          headers: {},
          bodyTemplate: "",
          botToken: "",
          chatId: "",
          discordWebhookUrl: "",
          teamsWebhookUrl: "",
        },
      },
  });

  const selectedType = form.watch("type");

  const testConnection = async () => {
    setIsTesting(true);
    try {
      const data = form.getValues();

      const response = await fetch("/api/notification-providers/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: data.type,
          config: data.config,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(result.message || "Connection test successful!");
      } else {
        const friendlyError = getUserFriendlyError(result.error, data.type);
        toast.error(friendlyError);
      }
    } catch (error) {
      console.error("Error testing connection:", error);
      const currentData = form.getValues();
      const friendlyError = getUserFriendlyError(error, currentData.type);
      toast.error(friendlyError);
    } finally {
      setIsTesting(false);
    }
  };

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      // Pass the data to the parent component - parent handles toast
      await onSuccess?.(data);

      // Reset form only if not in edit mode
      if (!initialData) {
        form.reset();
      }
    } catch (error) {
      console.error("Error saving notification provider:", error);
      const friendlyError = getUserFriendlyError(error, data.type);
      toast.error(friendlyError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 max-h-full"
      >
        {maskedFields.length > 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            Sensitive fields ({friendlyMaskedFields.join(", ")}) are hidden for
            security. Please re-enter them to keep this channel active.
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Channel Type</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  disabled={isSubmitting || isTesting}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select channel type">
                        {field.value && (
                          <div className="flex items-center gap-2">
                            {(() => {
                              const provider = notificationProviders.find(p => p.type === field.value);
                              if (!provider) return null;
                              const Icon = provider.icon;
                              return (
                                <>
                                  <Icon size={16} className={provider.color} />
                                  <span>{provider.label}</span>
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {notificationProviders.map((provider) => {
                      const Icon = provider.icon;
                      return (
                        <SelectItem key={provider.type} value={provider.type}>
                          <div className="flex items-center gap-2">
                            <Icon size={16} className={provider.color} />
                            <span>{provider.label}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="config.name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    placeholder="My Email Alerts"
                    {...field}
                    disabled={isSubmitting || isTesting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Email Configuration */}
        {selectedType === "email" && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Email Configuration</h3>
            <FormField
              control={form.control}
              name="config.emails"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Addresses</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="admin@yourcompany.com, team@yourcompany.com, alerts@yourcompany.com"
                      className="min-h-[80px] max-h-[150px] resize-y"
                      maxLength={CHARACTER_LIMITS.emails}
                      disabled={isSubmitting || isTesting}
                      {...field}
                    />
                  </FormControl>
                  <div className="text-sm text-muted-foreground">
                    Enter email addresses separated by commas. Maximum{" "}
                    {CHARACTER_LIMITS.emails} characters.
                    <br />
                    SMTP configuration will be managed through environment
                    variables.
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Slack Configuration */}
        {selectedType === "slack" && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Slack Configuration</h3>
            <FormField
              control={form.control}
              name="config.webhookUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Webhook URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://hooks.slack.com/services/..."
                      {...field}
                      disabled={isSubmitting || isTesting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="config.channel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Channel (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="#alerts"
                      {...field}
                      disabled={isSubmitting || isTesting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Webhook Configuration */}
        {selectedType === "webhook" && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Webhook Configuration</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="config.url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://api.yourservice.com/alerts"
                        {...field}
                        disabled={isSubmitting || isTesting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="config.method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Method</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={isSubmitting || isTesting}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="config.bodyTemplate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Body Template{" "}
                    <span className="text-xs text-muted-foreground bg-muted rounded-sm px-1.5 py-0.5">
                      Optional
                    </span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='{"message": "Monitor {{monitorName}} is {{status}}"}'
                      disabled={isSubmitting || isTesting}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Telegram Configuration */}
        {selectedType === "telegram" && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Telegram Configuration</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="config.botToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bot Token</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                        {...field}
                        disabled={isSubmitting || isTesting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="config.chatId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chat ID</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="-123456789"
                        {...field}
                        disabled={isSubmitting || isTesting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        )}

        {/* Discord Configuration */}
        {selectedType === "discord" && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Discord Configuration</h3>
            <FormField
              control={form.control}
              name="config.discordWebhookUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Webhook URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://discord.com/api/webhooks/..."
                      {...field}
                      disabled={isSubmitting || isTesting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Teams Configuration */}
        {selectedType === "teams" && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Microsoft Teams Configuration</h3>
            <FormField
              control={form.control}
              name="config.teamsWebhookUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Incoming Webhook URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="https://xxxxx.webhook.office.com/webhookb2/..."
                      {...field}
                      disabled={isSubmitting || isTesting}
                    />
                  </FormControl>
                  <div className="text-sm text-muted-foreground">
                    Create an Incoming Webhook in your Teams channel settings.
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        <div className="flex justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={testConnection}
            disabled={isTesting || isSubmitting}
          >
            {isTesting ? "Testing..." : "Test Connection"}
          </Button>
          <div className="space-x-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isTesting}>
              {isSubmitting
                ? initialData
                  ? "Updating..."
                  : "Creating..."
                : initialData
                  ? "Update Provider"
                  : "Create Provider"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
