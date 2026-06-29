"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2 } from "lucide-react";

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
import { parseWebhookJsonTemplate } from "@/lib/notification-providers/webhook-template";
import { notificationProviders } from "@/components/alerts/data";
import {
  WEBHOOK_PRESET_IDS,
  WEBHOOK_PRESETS,
  applyWebhookPresetConfig,
  getWebhookPreset,
  type WebhookPresetId,
} from "@/lib/notification-providers/webhook-presets";
import { buildWebhookPayloadPreview } from "@/lib/notification-providers/webhook-preview";

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
      preset: z.enum(WEBHOOK_PRESET_IDS).optional(),
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
        .optional()
        .transform((val) => {
          if (!val) return undefined;
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : undefined;
        })
        .refine(
          (template) => {
            if (!template) return true;

            try {
              parseWebhookJsonTemplate(template);
              return true;
            } catch {
              return false;
            }
          },
          {
            message: "Body template must be valid JSON",
          }
        ),

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
  headers: "Custom headers",
  botToken: "Bot Token",
  discordWebhookUrl: "Discord Webhook URL",
  teamsWebhookUrl: "Teams Webhook URL",
};

type FormValues = z.infer<typeof notificationProviderSchema>;

type WebhookTestDetails = {
  method?: string;
  targetHost?: string;
  headerNames?: string[];
  requestBodyHash?: string;
  responseStatus?: number;
  responseStatusText?: string;
  responseHash?: string;
  elapsedMs?: number;
};

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
  const [lastWebhookTestDetails, setLastWebhookTestDetails] =
    useState<WebhookTestDetails | null>(null);
  const [headersText, setHeadersText] = useState(() => {
    const headers = initialData
      ? ((initialData.config as Record<string, unknown>)
          .headers as Record<string, string> | undefined)
      : undefined;
    return headers && Object.keys(headers).length > 0
      ? JSON.stringify(headers, null, 2)
      : "";
  });

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
          preset:
            (getWebhookPreset(
              (initialData.config as Record<string, unknown>).preset,
            )?.id as WebhookPresetId | undefined) || "custom",
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
          preset: "custom",
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
  const selectedPresetId = form.watch("config.preset") || "custom";
  const selectedPreset = getWebhookPreset(selectedPresetId);
  const selectedWebhookMethod = form.watch("config.method");
  const selectedWebhookBodyTemplate = form.watch("config.bodyTemplate");
  const webhookPayloadPreview =
    selectedType === "webhook"
      ? buildWebhookPayloadPreview({
        method: selectedWebhookMethod,
        bodyTemplate: selectedWebhookBodyTemplate,
      })
      : null;

  const parseHeadersText = (): Record<string, string> | undefined => {
    const trimmed = headersText.trim();
    if (!trimmed) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Webhook headers must be valid JSON.");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Webhook headers must be a JSON object.");
    }

    const headers = parsed as Record<string, unknown>;
    const invalidHeader = Object.entries(headers).find(
      ([, value]) => typeof value !== "string",
    );
    if (invalidHeader) {
      throw new Error(
        `Webhook header "${invalidHeader[0]}" value must be a string.`,
      );
    }

    return Object.keys(headers).length > 0
      ? (headers as Record<string, string>)
      : undefined;
  };

  const prepareWebhookData = (data: FormValues): FormValues => {
    if (data.type !== "webhook") {
      return data;
    }

    const nextConfig = { ...data.config };
    const parsedHeaders = parseHeadersText();
    if (parsedHeaders) {
      nextConfig.headers = parsedHeaders;
    } else {
      delete nextConfig.headers;
    }

    return {
      ...data,
      config: nextConfig,
    };
  };

  const handleWebhookPresetChange = (presetId: WebhookPresetId) => {
    const currentConfig = form.getValues("config") as NotificationProviderConfig;
    const nextConfig = applyWebhookPresetConfig(presetId, currentConfig);
    const preset = getWebhookPreset(presetId);
    setLastWebhookTestDetails(null);

    form.setValue("config.preset", presetId, { shouldDirty: true });
    form.setValue("config.method", nextConfig.method || "POST", {
      shouldDirty: true,
    });
    form.setValue("config.bodyTemplate", nextConfig.bodyTemplate || "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("config.headers", nextConfig.headers || {}, {
      shouldDirty: true,
    });
    setHeadersText(
      nextConfig.headers && Object.keys(nextConfig.headers).length > 0
        ? JSON.stringify(nextConfig.headers, null, 2)
        : "",
    );

    const currentUrl = form.getValues("config.url");
    if (
      !currentUrl &&
      preset?.endpointPlaceholder.startsWith("https://") &&
      !preset.endpointPlaceholder.includes("<") &&
      !preset.endpointPlaceholder.includes("...")
    ) {
      form.setValue("config.url", preset.endpointPlaceholder, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  const testConnection = async () => {
    setIsTesting(true);
    setLastWebhookTestDetails(null);
    try {
      const data = prepareWebhookData(form.getValues());

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
      if (
        data.type === "webhook" &&
        result.details &&
        typeof result.details === "object"
      ) {
        setLastWebhookTestDetails(result.details as WebhookTestDetails);
      }

      if (result.success) {
        const status =
          data.type === "webhook" && result.details?.responseStatus
            ? ` (HTTP ${result.details.responseStatus})`
            : "";
        toast.success(
          `${result.message || "Connection test successful!"}${status}`,
        );
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
      const preparedData = prepareWebhookData(data);

      // Pass the data to the parent component - parent handles toast
      await onSuccess?.(preparedData);

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
                  onValueChange={(value) => {
                    field.onChange(value);
                    setLastWebhookTestDetails(null);
                  }}
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
            <FormField
              control={form.control}
              name="config.preset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Integration preset</FormLabel>
                  <Select
                    onValueChange={(value) =>
                      handleWebhookPresetChange(value as WebhookPresetId)
                    }
                    value={field.value || "custom"}
                    disabled={isSubmitting || isTesting}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select preset" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {WEBHOOK_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {selectedPreset && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="font-medium">{selectedPreset.label}</div>
                    <p className="text-muted-foreground">
                      {selectedPreset.summary}
                    </p>
                    <p className="text-muted-foreground">
                      Endpoint:{" "}
                      <code className="rounded bg-background px-1 py-0.5">
                        {selectedPreset.endpointPlaceholder}
                      </code>
                    </p>
                    {selectedPreset.secretHint && (
                      <p className="text-muted-foreground">
                        {selectedPreset.secretHint}
                      </p>
                    )}
                  </div>
                  <a
                    href={selectedPreset.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Setup docs
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            )}
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
                        onChange={(event) => {
                          field.onChange(event);
                          setLastWebhookTestDetails(null);
                        }}
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
                      onValueChange={(value) => {
                        field.onChange(value);
                        setLastWebhookTestDetails(null);
                      }}
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
            <FormItem>
              <FormLabel>
                Headers JSON{" "}
                <span className="text-xs text-muted-foreground bg-muted rounded-sm px-1.5 py-0.5">
                  Optional
                </span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder={
                    '{\n  "Authorization": "Bearer your-token"\n}'
                  }
                  value={headersText}
                  onChange={(event) => {
                    setHeadersText(event.target.value);
                    setLastWebhookTestDetails(null);
                  }}
                  className="min-h-[90px] font-mono text-sm"
                  disabled={isSubmitting || isTesting}
                />
              </FormControl>
              <div className="text-sm text-muted-foreground">
                Use this for provider API keys such as{" "}
                <code>Authorization</code>. Supercheck validates and encrypts
                headers, and blocks transport headers like{" "}
                <code>Host</code>, <code>Content-Type</code>, and{" "}
                <code>User-Agent</code>.
              </div>
            </FormItem>
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
                      placeholder='{"payload": {"summary": "{{title}}", "severity": "{{normalizedSeverity}}"}}'
                      disabled={isSubmitting || isTesting}
                      {...field}
                      onChange={(event) => {
                        field.onChange(event);
                        setLastWebhookTestDetails(null);
                      }}
                    />
                  </FormControl>
                  <div className="text-sm text-muted-foreground">
                    Templates must be valid JSON. Supercheck safely escapes
                    variables like{" "}
                    <code>{"{{title}}"}</code>, <code>{"{{status}}"}</code>,
                    <code>{"{{normalizedSeverity}}"}</code>,{" "}
                    <code>{"{{pagerDutyEventAction}}"}</code>, and{" "}
                    <code>{"{{dedupKey}}"}</code> when sending webhook
                    payloads.
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            {webhookPayloadPreview && (
              <div className="rounded-lg border border-border bg-muted/20">
                <div className="flex flex-col gap-1 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      Rendered sample payload
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Uses sample alert values only. Header values and endpoint
                      secrets are never rendered here.
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
                    {webhookPayloadPreview.method}
                  </span>
                </div>
                <div className="p-3">
                  {!webhookPayloadPreview.hasBody ? (
                    <p className="text-sm text-muted-foreground">
                      GET requests do not send a request body.
                    </p>
                  ) : webhookPayloadPreview.error ? (
                    <p className="text-sm text-destructive">
                      {webhookPayloadPreview.error}
                    </p>
                  ) : (
                    <pre className="max-h-56 overflow-auto rounded-md bg-background p-3 text-xs leading-relaxed text-foreground">
                      {webhookPayloadPreview.body}
                    </pre>
                  )}
                </div>
              </div>
            )}
            {lastWebhookTestDetails && (
              <div className="rounded-lg border border-border bg-background p-3 text-sm">
                <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="font-medium">Last webhook test</div>
                  {typeof lastWebhookTestDetails.elapsedMs === "number" && (
                    <span className="text-xs text-muted-foreground">
                      {lastWebhookTestDetails.elapsedMs} ms
                    </span>
                  )}
                </div>
                <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
                  <div>
                    Method:{" "}
                    <span className="font-medium text-foreground">
                      {lastWebhookTestDetails.method || "unknown"}
                    </span>
                  </div>
                  <div>
                    Host:{" "}
                    <span className="font-medium text-foreground">
                      {lastWebhookTestDetails.targetHost || "unknown"}
                    </span>
                  </div>
                  <div>
                    Status:{" "}
                    <span className="font-medium text-foreground">
                      {lastWebhookTestDetails.responseStatus
                        ? `HTTP ${lastWebhookTestDetails.responseStatus}`
                        : "No response"}
                    </span>
                  </div>
                  <div>
                    Headers:{" "}
                    <span className="font-medium text-foreground">
                      {lastWebhookTestDetails.headerNames?.length
                        ? lastWebhookTestDetails.headerNames.join(", ")
                        : "none"}
                    </span>
                  </div>
                </div>
                {lastWebhookTestDetails.requestBodyHash && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Request hash:{" "}
                    <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">
                      {lastWebhookTestDetails.requestBodyHash}
                    </code>
                  </div>
                )}
                {lastWebhookTestDetails.responseHash && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Response hash:{" "}
                    <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">
                      {lastWebhookTestDetails.responseHash}
                    </code>
                  </div>
                )}
              </div>
            )}
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
                      placeholder="https://xxx.environment.api.powerplatform.com:443/powerautomate/..."
                      {...field}
                      disabled={isSubmitting || isTesting}
                    />
                  </FormControl>
                  <div className="text-sm text-muted-foreground">
                    Create a Workflow webhook in Power Automate from your Teams channel.
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
            {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isTesting ? "Testing..." : "Test Connection"}
          </Button>
          <div className="space-x-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting || isTesting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isTesting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
