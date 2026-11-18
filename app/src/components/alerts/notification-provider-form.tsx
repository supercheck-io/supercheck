"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { notificationProviders, PAGING_SERVICE_NAMES } from "@/components/alerts/data";
import { ChannelTypeIcon } from "@/components/alerts/channel-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  WEBHOOK_PRESET_IDS,
  WEBHOOK_PRESETS,
  applyWebhookPresetConfig,
  getWebhookPreset,
  type WebhookPresetId,
} from "@/lib/notification-providers/webhook-presets";
import { buildWebhookPayloadPreview } from "@/lib/notification-providers/webhook-preview";

export const createNotificationProviderSchema = (
  preservedSensitiveFields = new Set<string>(),
  initialType?: NotificationProviderType,
) => z
  .object({
    type: z.enum(["email", "slack", "webhook", "telegram", "discord", "teams"] as const),
    config: z.object({
      name: z.string().min(1, "Title is required"),

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
            message: "Enter a valid URL. HTTPS is required unless internal webhook targets are enabled",
          }
        ),
      method: z.enum(["GET", "POST", "PUT"]).optional(),
      headers: z.record(z.string(), z.string()).optional(),
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
  .superRefine((data, ctx) => {
    // Required fields are enforced per channel type and mapped to their field
    // path so the error renders next to the input instead of at the form root.
    const config = data.config;

    switch (data.type) {
      case "email":
        if (!config.emails?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["config", "emails"],
            message: "At least one email address is required",
          });
        }
        break;
      case "slack":
        if (!config.webhookUrl && !(data.type === initialType && preservedSensitiveFields.has("webhookUrl"))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["config", "webhookUrl"],
            message: "Slack webhook URL is required",
          });
        }
        break;
      case "webhook":
        if (!config.url?.trim() && !(data.type === initialType && preservedSensitiveFields.has("url"))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["config", "url"],
            message: "Webhook URL is required",
          });
        }
        break;
      case "telegram":
        if (!config.botToken && !(data.type === initialType && preservedSensitiveFields.has("botToken"))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["config", "botToken"],
            message: "Bot token is required",
          });
        }
        if (!config.chatId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["config", "chatId"],
            message: "Chat ID is required",
          });
        }
        break;
      case "discord":
        if (!config.discordWebhookUrl && !(data.type === initialType && preservedSensitiveFields.has("discordWebhookUrl"))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["config", "discordWebhookUrl"],
            message: "Discord webhook URL is required",
          });
        }
        break;
      case "teams":
        if (!config.teamsWebhookUrl && !(data.type === initialType && preservedSensitiveFields.has("teamsWebhookUrl"))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["config", "teamsWebhookUrl"],
            message: "Teams webhook URL is required",
          });
        }
        break;
    }
  });

const MASKED_FIELD_LABELS: Record<string, string> = {
  webhookUrl: "Webhook URL",
  url: "Target URL",
  headers: "Custom headers",
  botToken: "Bot token",
  discordWebhookUrl: "Discord webhook URL",
  teamsWebhookUrl: "Teams webhook URL",
};

const WEBHOOK_DOCS_URL =
  "https://supercheck.io/docs/app/communicate/alerts#body-template";

type FormValues = z.input<ReturnType<typeof createNotificationProviderSchema>>;

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
    name?: string;
    type: NotificationProviderType;
    config: NotificationProviderConfig;
    maskedFields?: string[];
  };
  defaultType?: NotificationProviderType;
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  );
}

/** Visible label for the selected channel type, shared with the dropdown trigger. */
function channelTypeLabel(type: string, presetId: string) {
  if (type === "webhook") return PAGING_SERVICE_NAMES[presetId] ?? "Custom webhook";
  return notificationProviders.find((p) => p.type === type)?.label ?? type;
}

function OptionalBadge() {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Optional
    </span>
  );
}

function parseHeadersValue(
  text: string,
): Record<string, string> | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Headers must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers must be a JSON object.");
  }

  const headers = parsed as Record<string, unknown>;
  const invalidHeader = Object.entries(headers).find(
    ([, value]) => typeof value !== "string",
  );
  if (invalidHeader) {
    throw new Error(`Header "${invalidHeader[0]}" value must be a string.`);
  }

  return Object.keys(headers).length > 0
    ? (headers as Record<string, string>)
    : undefined;
}

function getHeadersError(text: string): string | null {
  if (!text.trim()) {
    return null;
  }
  try {
    parseHeadersValue(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid headers.";
  }
}

const MASKED_PLACEHOLDER = "Unchanged — leave blank to keep";
const SAVE_ERROR_TOAST_ID = "notification-provider-save-error";

/**
 * The URL the user typed, for the side card; undefined until it parses. Userinfo, query and fragment are dropped, and the
 * path is hidden (`https://hooks.slack.com/…`) when it has more than one segment or one that looks like a token, since
 * Slack, Discord and Teams webhook URLs carry their secret in the path.
 */
export function endpointForDisplay(value: string | undefined): string | undefined {
  try {
    const url = new URL((value ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const segments = url.pathname.split("/").filter(Boolean);
    const secretLooking = segments.length > 1 || segments.some((segment) => segment.length >= 20);
    return segments.length === 0 ? url.origin : secretLooking ? `${url.origin}/…` : url.origin + url.pathname;
  } catch {
    return undefined;
  }
}

/** The API's 400 messages are specific and safe to show; only network failures need the generic text. */
/**
 * The endpoint after choosing a webhook preset, or undefined to keep the current one. Moving from one paging service to
 * another drops the old endpoint: keeping it would send the new service's key (now in the headers) to the old service.
 * An empty endpoint gets the new preset's fixed URL when it has one.
 */
export function nextPresetUrl(
  previousPresetId: string,
  presetId: string,
  currentUrl: string | undefined,
  preset: { id: string; endpointPlaceholder: string } | undefined,
): string | undefined {
  const switchedService = previousPresetId !== "custom" && previousPresetId !== presetId;
  const url = switchedService ? "" : (currentUrl ?? "");
  const fixed =
    preset && preset.id !== "custom" && preset.endpointPlaceholder.startsWith("https://") && !preset.endpointPlaceholder.includes("<") && !preset.endpointPlaceholder.includes("...")
      ? preset.endpointPlaceholder
      : undefined;
  if (!url && fixed) return fixed;
  return switchedService ? "" : undefined;
}

export function getSaveErrorMessage(error: unknown, type: string): string {
  return error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError) && error.message
    ? error.message
    : getUserFriendlyError(error, type);
}

export function NotificationProviderForm({
  onSuccess,
  onCancel,
  initialData,
  defaultType,
}: NotificationProviderFormProps) {
  const headersFieldId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [lastWebhookTestDetails, setLastWebhookTestDetails] =
    useState<WebhookTestDetails | null>(null);

  const maskedFields = initialData?.maskedFields;
  const friendlyMaskedFields = (maskedFields ?? []).map(
    (field) => MASKED_FIELD_LABELS[field] ?? field
  );
  const maskedFieldSet = useMemo(
    () => new Set(maskedFields ?? []),
    [maskedFields],
  );
  const notificationProviderSchema = useMemo(
    () => createNotificationProviderSchema(maskedFieldSet, initialData?.type),
    [initialData?.type, maskedFieldSet],
  );
  const rawInitialConfig = (initialData?.config ?? {}) as Record<
    string,
    unknown
  >;
  // Masked secrets are never echoed back into the form. On same-type edits,
  // blanks are omitted so the API can preserve the encrypted values.
  const initialString = (field: string): string =>
    !initialData ||
    maskedFieldSet.has(field) ||
    typeof rawInitialConfig[field] !== "string"
      ? ""
      : (rawInitialConfig[field] as string);
  const initialHeadersText = (() => {
    if (!initialData || maskedFieldSet.has("headers")) {
      return "";
    }
    const headers = rawInitialConfig.headers as
      | Record<string, string>
      | undefined;
    return headers && Object.keys(headers).length > 0
      ? JSON.stringify(headers, null, 2)
      : "";
  })();

  const [headersText, setHeadersText] = useState(initialHeadersText);
  const [headersError, setHeadersError] = useState<string | null>(() =>
    getHeadersError(initialHeadersText),
  );

  const form = useForm<
    FormValues,
    unknown,
    z.output<ReturnType<typeof createNotificationProviderSchema>>
  >({
    resolver: zodResolver(notificationProviderSchema),
    mode: "onSubmit", // Only validate on submit, not on every change
    defaultValues: initialData
      ? {
        type: initialData.type,
        config: {
          name:
            initialString("name") ||
            (typeof initialData.name === "string" ? initialData.name : ""),
          emails: initialString("emails"),
          webhookUrl: initialString("webhookUrl"),
          channel: initialString("channel"),
          url: initialString("url"),
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
          botToken: initialString("botToken"),
          chatId: initialString("chatId"),
          discordWebhookUrl: initialString("discordWebhookUrl"),
          teamsWebhookUrl: initialString("teamsWebhookUrl"),
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
  const selectedWebhookUrl = form.watch("config.url");
  const selectedWebhookMethod = form.watch("config.method");
  const selectedWebhookBodyTemplate = form.watch("config.bodyTemplate");
  const webhookPayloadPreview =
    selectedType === "webhook"
      ? buildWebhookPayloadPreview({
        method: selectedWebhookMethod,
        bodyTemplate: selectedWebhookBodyTemplate,
        preset: selectedPresetId,
      })
      : null;

  const prepareWebhookData = (data: FormValues): FormValues => {
    const nextConfig: Record<string, unknown> = { ...data.config };
    if (data.type === "webhook") {
      const parsedHeaders = parseHeadersValue(headersText);
      if (parsedHeaders) {
        nextConfig.headers = parsedHeaders;
      } else {
        delete nextConfig.headers;
      }
    }

    if (data.type === initialData?.type) {
      for (const field of maskedFieldSet) {
        if (nextConfig[field] === "" || nextConfig[field] === undefined) {
          delete nextConfig[field];
        }
      }
    }

    return {
      ...data,
      config: nextConfig as FormValues["config"],
    };
  };

  const handleWebhookPresetChange = (presetId: WebhookPresetId) => {
    const currentConfig = form.getValues("config") as NotificationProviderConfig;
    const previousPresetId = form.getValues("config.preset") || "custom";
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
    const nextHeadersText =
      nextConfig.headers && Object.keys(nextConfig.headers).length > 0
        ? JSON.stringify(nextConfig.headers, null, 2)
        : "";
    setHeadersText(nextHeadersText);
    setHeadersError(getHeadersError(nextHeadersText));

    const nextUrl = nextPresetUrl(previousPresetId, presetId, form.getValues("config.url"), preset);
    if (nextUrl !== undefined) form.setValue("config.url", nextUrl, { shouldDirty: true, shouldValidate: true });
  };

  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    const subscription = form.watch(() => setTestResult(null));
    return () => subscription.unsubscribe();
  }, [form]);

  const testConnection = async () => {
    if (form.getValues("type") === "webhook") {
      const error = getHeadersError(headersText);
      if (error) {
        setHeadersError(error);
        toast.error(error);
        return;
      }
    }

    setIsTesting(true);
    setLastWebhookTestDetails(null);
    setTestResult(null);
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
        const message = `${result.message || "Connection test successful!"}${status}`;
        setTestResult({ ok: true, message });
        toast.success(message);
      } else {
        const friendlyError = getUserFriendlyError(result.error, data.type);
        setTestResult({ ok: false, message: friendlyError });
        toast.error(friendlyError);
      }
    } catch (error) {
      console.error("Error testing connection:", error);
      const currentData = form.getValues();
      const friendlyError = getUserFriendlyError(error, currentData.type);
      setTestResult({ ok: false, message: friendlyError });
      toast.error(friendlyError);
    } finally {
      setIsTesting(false);
    }
  };

  const onSubmit = async (data: FormValues) => {
    if (data.type === "webhook") {
      const error = getHeadersError(headersText);
      if (error) {
        setHeadersError(error);
        toast.error(error);
        return;
      }
    }

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
      toast.error(getSaveErrorMessage(error, data.type), { id: SAVE_ERROR_TOAST_ID });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onKeyDown={(event) => {
          // Enter in a single-line field must not submit by accident; the Create button does.
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 sm:py-5">
          {(maskedFields?.length ?? 0) > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Sensitive fields ({friendlyMaskedFields.join(", ")}) are hidden for
              security. Leave them blank to keep the existing values, or enter
              replacements to change them.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Channel type<RequiredMark /></FormLabel>
                  <Select
                    onValueChange={(value) => {
                      setLastWebhookTestDetails(null);
                      // Paging services are webhooks with a preset; storage does not change.
                      if (value.startsWith("paging:")) {
                        const presetId = value.slice("paging:".length) as WebhookPresetId;
                        field.onChange("webhook");
                        // Coming back to the same service (for example via Email) keeps the edited template and headers.
                        if (presetId !== selectedPresetId) handleWebhookPresetChange(presetId);
                        return;
                      }
                      field.onChange(value);
                      if (value === "webhook" && selectedPresetId !== "custom") handleWebhookPresetChange("custom");
                    }}
                    value={field.value === "webhook" && selectedPresetId !== "custom" ? `paging:${selectedPresetId}` : field.value}
                    disabled={isSubmitting || isTesting}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="channel-type-select">
                        <SelectValue placeholder="Select channel type">
                          {field.value && (
                            <div className="flex items-center gap-2">
                              <ChannelTypeIcon type={field.value} presetId={selectedPresetId} />
                              <span>{channelTypeLabel(field.value, selectedPresetId)}</span>
                            </div>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
                      <SelectGroup>
                        <SelectLabel>Chat and email</SelectLabel>
                        {notificationProviders.filter((p) => p.type !== "webhook").map((provider) => (
                          <SelectItem key={provider.type} value={provider.type}>
                            <div className="flex items-center gap-2">
                              <ChannelTypeIcon type={provider.type} />
                              <span>{provider.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Paging and on-call</SelectLabel>
                        {WEBHOOK_PRESETS.filter((preset) => preset.id !== "custom").map((preset) => (
                          <SelectItem key={preset.id} value={`paging:${preset.id}`}>
                            <div className="flex items-center gap-2">
                              <ChannelTypeIcon type="webhook" presetId={preset.id} />
                              <span>{PAGING_SERVICE_NAMES[preset.id] ?? preset.label}</span>
                              {preset.endsAt && <span className="text-xs text-muted-foreground">Ends {preset.endsAt}</span>}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Webhooks</SelectLabel>
                        <SelectItem value="webhook">
                          <div className="flex items-center gap-2">
                            <ChannelTypeIcon type="webhook" />
                            <span>Custom webhook</span>
                          </div>
                        </SelectItem>
                      </SelectGroup>
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
                  <FormLabel>Title<RequiredMark /></FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. On-call alerts"
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
              <h3 className="text-sm font-semibold">Email configuration</h3>
              <FormField
                control={form.control}
                name="config.emails"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email addresses<RequiredMark /></FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g. oncall@example.com, team@example.com"
                        className="field-sizing-fixed min-h-[80px] resize-y"
                        maxLength={CHARACTER_LIMITS.emails}
                        disabled={isSubmitting || isTesting}
                        {...field}
                      />
                    </FormControl>
                    <div className="text-xs text-muted-foreground">
                      Enter email addresses separated by commas. Maximum{" "}
                      {CHARACTER_LIMITS.emails} characters. SMTP configuration is
                      managed through environment variables.
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
              <h3 className="text-sm font-semibold">Slack configuration</h3>
              <FormField
                control={form.control}
                name="config.webhookUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Webhook URL<RequiredMark /></FormLabel>
                    <FormControl>
                      <Input
                        placeholder={maskedFieldSet.has("webhookUrl") ? MASKED_PLACEHOLDER : "e.g. https://hooks.slack.com/services/T000/B000/XXXX"}
                        {...field}
                        disabled={isSubmitting || isTesting}
                      />
                    </FormControl>
                    <FormDescription>Create an incoming webhook in your Slack workspace and paste its URL.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="config.channel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Channel<OptionalBadge /></FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. #alerts"
                        {...field}
                        disabled={isSubmitting || isTesting}
                      />
                    </FormControl>
                    <FormDescription>Overrides the default channel set on the webhook. Leave blank to use the default.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Webhook Configuration */}
          {selectedType === "webhook" && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Webhook configuration</h3>
              <div className="grid gap-5 lg:grid-cols-2">
                {/* Primary inputs */}
                <div className="space-y-4">
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
                          <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
                            {WEBHOOK_PRESETS.map((preset) => (
                              <SelectItem key={preset.id} value={preset.id}>
                                <div className="flex items-center gap-2">
                                  <ChannelTypeIcon type="webhook" presetId={preset.id} />
                                  <span>
                                    {preset.label}
                                    {preset.endsAt ? ` (ends ${preset.endsAt})` : ""}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedPresetId !== "custom" && (
                    <Alert variant="info" data-testid="one-way-paging-note">
                      <AlertDescription>
                        Supercheck opens and resolves the page. Acknowledging or closing it in{" "}
                        {PAGING_SERVICE_NAMES[selectedPresetId] ?? "the paging service"} does not change the Supercheck incident.
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <FormField
                      control={form.control}
                      name="config.url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>URL<RequiredMark /></FormLabel>
                          <FormControl>
                            <Input
                              placeholder={maskedFieldSet.has("url") ? MASKED_PLACEHOLDER : "e.g. https://api.example.com/alerts"}
                              {...field}
                              onChange={(event) => {
                                field.onChange(event);
                                setLastWebhookTestDetails(null);
                              }}
                              disabled={isSubmitting || isTesting}
                            />
                          </FormControl>
                          <FormDescription>Supercheck sends alerts to this endpoint. Stored encrypted.</FormDescription>
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
                            value={field.value ?? "POST"}
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

                  <div className="space-y-2">
                    <Label htmlFor={headersFieldId}>
                      Headers JSON
                      <OptionalBadge />
                    </Label>
                    <Textarea
                      id={headersFieldId}
                      placeholder={'{\n  "Authorization": "Bearer your-token"\n}'}
                      value={headersText}
                      onChange={(event) => {
                        const next = event.target.value;
                        setHeadersText(next);
                        setHeadersError(getHeadersError(next));
                        setLastWebhookTestDetails(null);
                        setTestResult(null);
                      }}
                      className="field-sizing-fixed min-h-[88px] resize-y font-mono text-sm"
                      aria-invalid={Boolean(headersError)}
                      disabled={isSubmitting || isTesting}
                    />
                    {headersError ? (
                      <p className="text-sm font-medium text-destructive">
                        {headersError}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Use for provider API keys such as{" "}
                        <code>Authorization</code>. Transport headers like{" "}
                        <code>Host</code>, <code>Content-Type</code>, and{" "}
                        <code>User-Agent</code> are blocked.
                      </p>
                    )}
                  </div>

                  <FormField
                    control={form.control}
                    name="config.bodyTemplate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Body template
                          <OptionalBadge />
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder='{"payload": {"summary": "{{title}}", "severity": "{{normalizedSeverity}}"}}'
                            className="field-sizing-fixed min-h-[88px] resize-y font-mono text-sm"
                            disabled={isSubmitting || isTesting}
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              setLastWebhookTestDetails(null);
                            }}
                          />
                        </FormControl>
                        <div className="text-xs text-muted-foreground">
                          Valid JSON with{" "}
                          <code>{"{{variable}}"}</code> placeholders such as{" "}
                          <code>{"{{title}}"}</code>,{" "}
                          <code>{"{{status}}"}</code>, and{" "}
                          <code>{"{{dedupKey}}"}</code>. Values are escaped
                          before sending.{" "}
                          <a
                            href={WEBHOOK_DOCS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                          >
                            Variables
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Reference preview */}
                <div className="space-y-4">
                  {selectedPreset && (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">
                          {selectedPreset.label}
                        </div>
                        <a
                          href={selectedPreset.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Setup docs
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedPreset.summary}
                      </p>
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0">Endpoint</span>
                        <code className="min-w-0 break-all rounded bg-background px-1 py-0.5">
                          {endpointForDisplay(selectedWebhookUrl) ?? selectedPreset.endpointPlaceholder}
                        </code>
                      </div>
                      {selectedPreset.secretHint && (
                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
                          {selectedPreset.secretHint}
                        </p>
                      )}
                    </div>
                  )}

                  {webhookPayloadPreview && (
                    <div className="rounded-lg border border-border bg-muted/20">
                      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            Rendered sample payload
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Sample alert values only. Secrets are never rendered.
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-background px-2 py-1 text-xs font-medium text-muted-foreground">
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
                          <pre className="max-h-64 overflow-auto rounded-md bg-background p-3 text-xs leading-relaxed text-foreground">
                            {webhookPayloadPreview.body}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}

                  {lastWebhookTestDetails && (
                    <div className="rounded-lg border border-border bg-background p-3 text-sm">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="font-medium">Last webhook test</div>
                        {typeof lastWebhookTestDetails.elapsedMs === "number" && (
                          <span className="text-xs text-muted-foreground">
                            {lastWebhookTestDetails.elapsedMs} ms
                          </span>
                        )}
                      </div>
                      <dl className="grid gap-2 text-muted-foreground sm:grid-cols-2">
                        <div>
                          Method:{" "}
                          <span className="font-medium text-foreground">
                            {lastWebhookTestDetails.method || "unknown"}
                          </span>
                        </div>
                        <div className="min-w-0 break-all">
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
                        <div className="min-w-0 break-all">
                          Headers:{" "}
                          <span className="font-medium text-foreground">
                            {lastWebhookTestDetails.headerNames?.length
                              ? lastWebhookTestDetails.headerNames.join(", ")
                              : "none"}
                          </span>
                        </div>
                      </dl>
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
              </div>
            </div>
          )}

          {/* Telegram Configuration */}
          {selectedType === "telegram" && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Telegram configuration</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="config.botToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bot token<RequiredMark /></FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder={maskedFieldSet.has("botToken") ? MASKED_PLACEHOLDER : "e.g. 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"}
                          {...field}
                          disabled={isSubmitting || isTesting}
                        />
                      </FormControl>
                      <FormDescription>Create a bot with @BotFather and paste its token. Stored encrypted.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.chatId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chat ID<RequiredMark /></FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. -1001234567890"
                          {...field}
                          disabled={isSubmitting || isTesting}
                        />
                      </FormControl>
                      <FormDescription>Numeric ID of the chat or group. Group IDs start with a minus sign.</FormDescription>
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
              <h3 className="text-sm font-semibold">Discord configuration</h3>
              <FormField
                control={form.control}
                name="config.discordWebhookUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Webhook URL<RequiredMark /></FormLabel>
                    <FormControl>
                      <Input
                        placeholder={maskedFieldSet.has("discordWebhookUrl") ? MASKED_PLACEHOLDER : "e.g. https://discord.com/api/webhooks/123/abc"}
                        {...field}
                        disabled={isSubmitting || isTesting}
                      />
                    </FormControl>
                    <FormDescription>In Discord: Channel settings, Integrations, Webhooks. Stored encrypted.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* Teams Configuration */}
          {selectedType === "teams" && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">
                Microsoft Teams configuration
              </h3>
              <FormField
                control={form.control}
                name="config.teamsWebhookUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Incoming webhook URL<RequiredMark /></FormLabel>
                    <FormControl>
                      <Input
                        placeholder={maskedFieldSet.has("teamsWebhookUrl") ? MASKED_PLACEHOLDER : "e.g. https://prod-00.westus.logic.azure.com:443/workflows/..."}
                        {...field}
                        disabled={isSubmitting || isTesting}
                      />
                    </FormControl>
                    <div className="text-xs text-muted-foreground">
                      Create a Workflow webhook in Power Automate from your Teams
                      channel.
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
        </div>

        {testResult && (
          <div
            role={testResult.ok ? "status" : "alert"}
            data-testid="test-connection-result"
            className={cn(
              "flex shrink-0 items-start gap-2 border-t px-6 py-3 text-sm",
              testResult.ok ? "bg-success/10 text-success" : "bg-failure/10 text-failure",
            )}
          >
            {testResult.ok ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 break-words">{testResult.message}</span>
          </div>
        )}
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-background px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={testConnection}
            disabled={isTesting || isSubmitting}
          >
            {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isTesting ? "Testing..." : "Test connection"}
          </Button>
          <div className="flex gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting || isTesting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isTesting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSubmitting
                ? initialData
                  ? "Updating..."
                  : "Creating..."
                : initialData
                  ? "Update channel"
                  : "Create channel"}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
