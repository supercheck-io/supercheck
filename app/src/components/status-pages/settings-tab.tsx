"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Bell,
  Palette,
  Settings2,
  Upload,
  Mail,
  Webhook,
  MessageSquare,
  Rss,
  ChevronDown,
  Image as ImageIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ui/copy-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  InfoHint,
  InfoHintText,
  InfoHintTitle,
} from "@/components/status-pages/info-hint";
import { toast } from "sonner";
import {
  updateStatusPageSettings,
  resetBrandingToDefaults,
} from "@/actions/update-status-page-settings";
import { verifyStatusPageDomain } from "@/actions/verify-status-page-domain";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { SUPPORTED_LANGUAGES } from "@/lib/status-page-translations";
import { useQueryClient } from "@tanstack/react-query";
import type { StatusPageDetailResponse } from "@/hooks/use-status-pages";
import { useAppConfig } from "@/hooks/use-app-config";
import {
  getStatusPageSupportContactInputValue,
  normalizeStatusPageSupportContact,
  statusPageSupportContactSchema,
} from "@/lib/status-page-support";
import {
  getStatusPageCustomDomainTargetResolutionHint,
  getStatusPageDomainOwnershipRecord,
  STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE,
} from "@/lib/status-page-domain-guidance";

const CUSTOM_DOMAIN_EXAMPLE_HOSTNAME = "status.example.net";

type StatusPage = {
  id: string;
  name: string;
  headline: string | null;
  pageDescription: string | null;
  supportUrl: string | null;
  timezone: string | null;
  allowPageSubscribers: boolean | null;
  allowEmailSubscribers: boolean | null;
  allowWebhookSubscribers: boolean | null;
  allowSlackSubscribers: boolean | null;
  allowIncidentSubscribers: boolean | null;
  allowRssFeed: boolean | null;
  customDomain: string | null;
  customDomainVerified: boolean | null;
  language: string | null;
  cssBodyBackgroundColor: string | null;
  cssFontColor: string | null;
  cssGreens: string | null;
  cssYellows: string | null;
  cssOranges: string | null;
  cssBlues: string | null;
  cssReds: string | null;
  faviconLogo: string | null;
  transactionalLogo: string | null;
};

type SettingsTabProps = {
  statusPage: StatusPage;
  canUpdate: boolean;
  statusPageDomain?: string;
  statusPageCnameTarget?: string;
};

const settingsSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name is too long")
    .trim(),
  headline: z.string().max(255, "Headline is too long").trim().optional(),
  pageDescription: z
    .string()
    .max(2000, "Description is too long")
    .trim()
    .optional(),
  supportUrl: statusPageSupportContactSchema.optional(),
  customDomain: z
    .string()
    .max(255)
    .regex(
      /^$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
      "Invalid domain format",
    )
    .optional()
    .or(z.literal("")),
  allowPageSubscribers: z.boolean(),
  allowEmailSubscribers: z.boolean(),
  allowWebhookSubscribers: z.boolean(),
  allowSlackSubscribers: z.boolean(),
  allowIncidentSubscribers: z.boolean(),
  allowRssFeed: z.boolean(),
  cssGreens: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  cssYellows: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  cssOranges: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  cssBlues: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  cssReds: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  language: z.string().min(2).max(10).optional(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

const normalizeHostname = (value: string): string => {
  return value.trim().toLowerCase().replace(/\.$/, "");
};

// Client-side equivalent of isReservedStatusPageHostname from status-page-domain.ts.
// Cannot import the server module directly because it pulls in process.env-dependent
// feature-flag helpers that are unavailable in the browser runtime.
const isReservedCustomDomain = (
  customDomain: string,
  statusPageDomain: string,
): boolean => {
  const hostname = normalizeHostname(customDomain);
  const baseDomain = normalizeHostname(statusPageDomain);

  if (!hostname || !baseDomain) {
    return false;
  }

  return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
};

const isPublicHostnameCandidate = (hostname: string): boolean => {
  const normalizedHostname = normalizeHostname(hostname);

  if (
    !normalizedHostname ||
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1" ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalizedHostname) ||
    normalizedHostname.includes(":") ||
    !normalizedHostname.includes(".")
  ) {
    return false;
  }

  return true;
};

export function SettingsTab({
  statusPage,
  canUpdate,
  statusPageDomain,
  statusPageCnameTarget,
}: SettingsTabProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    isSelfHosted,
    statusPageDomain: appConfigStatusPageDomain,
    statusPageCnameTarget: appConfigStatusPageCnameTarget,
  } = useAppConfig();
  const [isResetting, setIsResetting] = useState(false);
  const [isVerifyingDNS, setIsVerifyingDNS] = useState(false);
  const [dnsOpen, setDnsOpen] = useState(
    Boolean(statusPage.customDomain && !statusPage.customDomainVerified),
  );

  // Upload states
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const [logoUrl, setLogoUrl] = useState(statusPage.transactionalLogo || null);
  const [faviconUrl, setFaviconUrl] = useState(statusPage.faviconLogo || null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    resetField,
    reset,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: statusPage.name,
      headline: statusPage.headline || "",
      pageDescription: statusPage.pageDescription || "",
      supportUrl: getStatusPageSupportContactInputValue(statusPage.supportUrl),
      customDomain: statusPage.customDomain || "",
      allowPageSubscribers: statusPage.allowPageSubscribers ?? true,
      allowEmailSubscribers: statusPage.allowEmailSubscribers ?? true,
      allowWebhookSubscribers: statusPage.allowWebhookSubscribers ?? true,
      allowSlackSubscribers: statusPage.allowSlackSubscribers ?? true,
      allowIncidentSubscribers: statusPage.allowIncidentSubscribers ?? true,
      allowRssFeed: statusPage.allowRssFeed ?? true,
      cssGreens: statusPage.cssGreens || "#2ecc71",
      cssYellows: statusPage.cssYellows || "#f1c40f",
      cssOranges: statusPage.cssOranges || "#e67e22",
      cssBlues: statusPage.cssBlues || "#3498db",
      cssReds: statusPage.cssReds || "#e74c3c",
      language: statusPage.language || "en",
    },
  });

  const customDomainValue = watch("customDomain");
  const domainOwnership = getStatusPageDomainOwnershipRecord(
    customDomainValue || CUSTOM_DOMAIN_EXAMPLE_HOSTNAME,
    statusPage.id,
  );
  const effectiveStatusPageDomain = normalizeHostname(
    statusPageDomain || appConfigStatusPageDomain || "supercheck.io",
  );
  const effectiveStatusPageCnameTarget = normalizeHostname(
    statusPageCnameTarget ||
      appConfigStatusPageCnameTarget ||
      effectiveStatusPageDomain,
  );
  const customDomainConfigMessage =
    isSelfHosted && !isPublicHostnameCandidate(effectiveStatusPageCnameTarget)
      ? `Custom domains require a publicly reachable hostname. Set STATUS_PAGE_DOMAIN to a real DNS hostname instead of ${effectiveStatusPageCnameTarget}.`
      : null;
  const hasReservedCustomDomain =
    !!customDomainValue &&
    isReservedCustomDomain(customDomainValue, effectiveStatusPageDomain);

  const onSubmit = async (data: SettingsFormValues) => {
    try {
      const submittedHeadline = data.headline?.trim() ?? "";
      const submittedDescription = data.pageDescription?.trim() ?? "";
      const submittedSupportUrl = data.supportUrl?.trim() ?? "";
      const submittedCustomDomain = data.customDomain?.trim() ?? "";
      const submittedDomainChanged =
        (submittedCustomDomain || null) !== (statusPage.customDomain || null);

      if (
        submittedCustomDomain &&
        isReservedCustomDomain(submittedCustomDomain, effectiveStatusPageDomain)
      ) {
        toast.error("Invalid custom domain", {
          description: `Custom domains cannot use ${effectiveStatusPageDomain} or its subdomains. Use a separate hostname and point its CNAME to ${effectiveStatusPageCnameTarget}.`,
        });
        return;
      }

      const result = await updateStatusPageSettings({
        statusPageId: statusPage.id,
        ...data,
        headline: submittedHeadline,
        pageDescription: submittedDescription,
        supportUrl: submittedSupportUrl,
        customDomain: submittedCustomDomain,
        language: data.language,
      });

      if (result.success) {
        const normalizedLanguage = data.language || "en";
        const normalizedHeadline = submittedHeadline || null;
        const normalizedDescription = submittedDescription || null;
        const normalizedSupportUrl =
          normalizeStatusPageSupportContact(submittedSupportUrl);
        const supportUrlInputValue =
          getStatusPageSupportContactInputValue(normalizedSupportUrl);
        const normalizedCustomDomain = submittedCustomDomain || null;

        queryClient.setQueryData<StatusPageDetailResponse>(
          ["statusPage", statusPage.id, "detail"],
          (current) => {
            if (!current) return current;

            const domainChanged =
              normalizedCustomDomain !== current.statusPage.customDomain;

            return {
              ...current,
              statusPage: {
                ...current.statusPage,
                name: data.name,
                headline: normalizedHeadline,
                pageDescription: normalizedDescription,
                language: normalizedLanguage,
                supportUrl: normalizedSupportUrl,
                customDomain: normalizedCustomDomain,
                ...(domainChanged ? { customDomainVerified: false } : {}),
              },
            };
          },
        );

        await queryClient.invalidateQueries({
          queryKey: ["statusPage", statusPage.id, "detail"],
          refetchType: "active",
        });

        toast.success("Settings saved successfully");
        if (submittedDomainChanged) {
          setDnsOpen(Boolean(submittedCustomDomain));
        }
        reset({
          ...data,
          headline: normalizedHeadline ?? "",
          pageDescription: normalizedDescription ?? "",
          supportUrl: supportUrlInputValue,
          customDomain: normalizedCustomDomain ?? "",
          language: normalizedLanguage,
        });
        router.refresh();
      } else {
        toast.error("Failed to save settings", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("An unexpected error occurred");
    }
  };

  const handleVerifyDNS = async () => {
    if (!customDomainValue) return;
    setIsVerifyingDNS(true);
    try {
      const result = await verifyStatusPageDomain(statusPage.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error("Verification failed", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Error verifying DNS:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsVerifyingDNS(false);
    }
  };

  const handleResetBranding = async () => {
    setIsResetting(true);

    try {
      const result = await resetBrandingToDefaults(statusPage.id);

      if (result.success) {
        toast.success("Branding reset to defaults");
        // The reset persists immediately, so update each color's baseline
        // without clearing unsaved edits in other fields.
        resetField("cssGreens", { defaultValue: "#2ecc71" });
        resetField("cssYellows", { defaultValue: "#f1c40f" });
        resetField("cssOranges", { defaultValue: "#e67e22" });
        resetField("cssBlues", { defaultValue: "#3498db" });
        resetField("cssReds", { defaultValue: "#e74c3c" });

        // Reset logo and favicon URLs
        setLogoUrl(null);
        setFaviconUrl(null);
        router.refresh();
      } else {
        toast.error("Failed to reset branding");
      }
    } catch (error) {
      console.error("Error resetting branding:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setIsResetting(false);
    }
  };

  const handleFileUpload = async (file: File, type: "logo" | "favicon") => {
    const setUploading =
      type === "logo" ? setIsUploadingLogo : setIsUploadingFavicon;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);

      const response = await fetch(
        `/api/status-pages/${statusPage.id}/upload`,
        {
          method: "POST",
          body: formData,
        },
      );

      const result = await response.json();

      if (result.success) {
        toast.success(
          `${type === "logo" ? "Logo" : "Favicon"} uploaded successfully`,
        );

        if (type === "logo") {
          setLogoUrl(result.url);
        } else {
          setFaviconUrl(result.url);
        }

        router.refresh();
      } else {
        toast.error(result.message || "Upload failed");
      }
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("An unexpected error occurred");
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    type: "logo" | "favicon",
  ) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file size (5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error("File size must be less than 5MB");
        return;
      }

      // Validate file type
      const allowedTypes = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
        "image/svg+xml",
        "image/webp",
      ];
      if (!allowedTypes.includes(file.type)) {
        toast.error(
          "Please upload a valid image file (PNG, JPG, GIF, SVG, or WebP)",
        );
        return;
      }

      handleFileUpload(file, type);
    }
  };

  const subscriptionOptions = [
    {
      name: "allowPageSubscribers" as const,
      title: "Page subscriptions",
      description: "Let visitors subscribe to every update on this page.",
      icon: Bell,
    },
    {
      name: "allowEmailSubscribers" as const,
      title: "Email notifications",
      description: "Send incident and recovery updates by email.",
      icon: Mail,
    },
    {
      name: "allowWebhookSubscribers" as const,
      title: "Webhook notifications",
      description: "Let subscribers receive updates at their own endpoint.",
      icon: Webhook,
    },
    {
      name: "allowSlackSubscribers" as const,
      title: "Slack notifications",
      description: "Send updates to Slack channels through webhooks.",
      icon: MessageSquare,
    },
    {
      name: "allowIncidentSubscribers" as const,
      title: "Incident subscriptions",
      description: "Let visitors follow a single incident.",
      icon: AlertTriangle,
    },
    {
      name: "allowRssFeed" as const,
      title: "RSS and iCal feeds",
      description: "Publish feeds for readers and calendar apps.",
      icon: Rss,
    },
  ];

  const brandColors = [
    {
      name: "cssGreens" as const,
      label: "Operational",
      placeholder: "#2ecc71",
    },
    {
      name: "cssYellows" as const,
      label: "Degraded",
      placeholder: "#f1c40f",
    },
    {
      name: "cssOranges" as const,
      label: "Partial outage",
      placeholder: "#e67e22",
    },
    {
      name: "cssBlues" as const,
      label: "Maintenance",
      placeholder: "#3498db",
    },
    {
      name: "cssReds" as const,
      label: "Major outage",
      placeholder: "#e74c3c",
    },
  ];

  const normalizedCustomDomainValue = normalizeHostname(customDomainValue || "");
  const savedCustomDomain = normalizeHostname(statusPage.customDomain || "");
  const customDomainChanged =
    normalizedCustomDomainValue !== savedCustomDomain;
  const isSavedDomainInField =
    Boolean(customDomainValue) && normalizedCustomDomainValue === savedCustomDomain;
  const domainVerified = isSavedDomainInField && !!statusPage.customDomainVerified;
  const domainPending =
    isSavedDomainInField && !!statusPage.customDomain && !statusPage.customDomainVerified;
  const dnsHostname = customDomainValue || CUSTOM_DOMAIN_EXAMPLE_HOSTNAME;

  return (
    <div className={cn("space-y-5", isDirty && "pb-24")}>
      {/* General */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">General</CardTitle>
          </div>
          <CardDescription>
            Page identity, contact details, and language for visitors.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="name">Page name</Label>
              <InfoHint label="Internal name details">
                <InfoHintText>
                  Internal name used across the dashboard. Visitors see the
                  headline instead.
                </InfoHintText>
              </InfoHint>
            </div>
            <Input
              id="name"
              {...register("name")}
              placeholder="My status page"
              disabled={!canUpdate}
            />
            {errors.name && (
              <p className="text-sm text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="headline">Headline</Label>
              <InfoHint label="Public heading details">
                <InfoHintText>
                  Main heading on the public page. Falls back to the page name
                  when left empty.
                </InfoHintText>
              </InfoHint>
            </div>
            <Input
              id="headline"
              {...register("headline")}
              placeholder="System status"
              maxLength={255}
              disabled={!canUpdate}
            />
            {errors.headline && (
              <p className="text-sm text-red-500">{errors.headline.message}</p>
            )}
          </div>

          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="description">Description</Label>
              <InfoHint label="Public summary details">
                <InfoHintText>
                  Short summary shown below the headline on the public page.
                </InfoHintText>
              </InfoHint>
            </div>
            <Textarea
              id="description"
              {...register("pageDescription")}
              placeholder="Describe your services and what this status page tracks..."
              disabled={!canUpdate}
              className="resize-none"
              rows={2}
            />
            {errors.pageDescription && (
              <p className="text-sm text-red-500">
                {errors.pageDescription.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="supportUrl">Support contact</Label>
              <InfoHint label="Contact options">
                <InfoHintText>
                  Shown as a contact button on the public page. Email addresses
                  open the visitor&apos;s mail app; URLs open in a new tab.
                </InfoHintText>
              </InfoHint>
            </div>
            <Input
              id="supportUrl"
              type="text"
              {...register("supportUrl")}
              placeholder="support@example.com or https://support.example.com"
              disabled={!canUpdate}
            />
            {errors.supportUrl && (
              <p className="text-sm text-red-500">
                {errors.supportUrl.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="language">Language</Label>
              <InfoHint label="Translation details">
                <InfoHintText>
                  Applies to public page text and subscriber emails.
                </InfoHintText>
              </InfoHint>
            </div>
            <Controller
              control={control}
              name="language"
              render={({ field }) => (
                <Select
                  value={field.value || "en"}
                  onValueChange={field.onChange}
                  disabled={!canUpdate}
                >
                  <SelectTrigger id="language" className="w-full">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.nativeLabel} ({lang.label})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* Custom domain */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Custom domain</CardTitle>
            <InfoHint label="Domain setup details">
              <InfoHintTitle>Custom domain setup</InfoHintTitle>
              <InfoHintText>
                Point a CNAME from your hostname to{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {effectiveStatusPageCnameTarget}
                </code>
                . The hostname can live in any DNS zone.
              </InfoHintText>
              <InfoHintText>
                {getStatusPageCustomDomainTargetResolutionHint(
                  effectiveStatusPageCnameTarget,
                )}
              </InfoHintText>
              <InfoHintText>
                If a wildcard or A/AAAA record already covers that target, you
                can reuse it.
              </InfoHintText>
              <InfoHintText>
                On Cloudflare, keep the record on DNS only during verification.{" "}
                {STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE}
              </InfoHintText>
              <InfoHintText>
                Do not use{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {effectiveStatusPageDomain}
                </code>{" "}
                or any of its subdomains.
              </InfoHintText>
              {isSelfHosted && (
                <InfoHintText>
                  Routing is automatic after verification. Origin TLS still needs
                  a certificate for the custom hostname.
                </InfoHintText>
              )}
            </InfoHint>
          </div>
          <CardDescription>
            Serve this status page from your own hostname, like
            status.example.com.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder={CUSTOM_DOMAIN_EXAMPLE_HOSTNAME}
              {...register("customDomain")}
              disabled={!canUpdate}
              className="font-mono text-sm sm:max-w-md"
            />
            {customDomainValue ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleVerifyDNS}
                disabled={
                  isVerifyingDNS ||
                  !canUpdate ||
                  customDomainChanged ||
                  hasReservedCustomDomain ||
                  Boolean(customDomainConfigMessage)
                }
                title={
                  customDomainChanged ? "Save changes to enable verification" : ""
                }
                className="shrink-0"
              >
                {isVerifyingDNS ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Verify DNS"
                )}
              </Button>
            ) : null}
          </div>

          {customDomainChanged && customDomainValue && (
            <p className="text-xs text-muted-foreground">
              Save changes to enable domain verification.
            </p>
          )}

          {errors.customDomain && (
            <p className="text-sm text-red-500">
              {errors.customDomain.message}
            </p>
          )}

          {customDomainConfigMessage && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{customDomainConfigMessage}</p>
            </div>
          )}

          {hasReservedCustomDomain && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This domain is reserved for default status page routing. Use a
                different hostname and point its CNAME to{" "}
                <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/60">
                  {effectiveStatusPageCnameTarget}
                </code>
                .
              </p>
            </div>
          )}

          {domainVerified && (
            <div className="inline-flex items-center gap-2 rounded-md bg-green-50 px-2.5 py-1.5 text-sm text-green-700 dark:bg-green-950/50 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4" />
              Domain verified and active
            </div>
          )}

          {domainPending && (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
              Pending verification. Add the records below, then select Verify DNS.
            </p>
          )}

          {!customDomainConfigMessage && (
          <Collapsible open={dnsOpen} onOpenChange={setDnsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    dnsOpen && "rotate-180",
                  )}
                />
                DNS records
                <Badge
                  variant="secondary"
                  className="ml-1 h-5 px-1.5 text-[10px] font-medium"
                >
                  2
                </Badge>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 space-y-4 rounded-lg border bg-muted/30 p-4">
                {customDomainConfigMessage ? (
                  <p className="text-sm text-muted-foreground">
                    Custom domains stay unavailable until your deployment
                    resolves a public hostname for status-page routing. Set{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      STATUS_PAGE_DOMAIN
                    </code>{" "}
                    to a real DNS hostname first. In the Docker Compose secure
                    and external examples, the target is derived automatically,
                    usually as{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      cname.STATUS_PAGE_DOMAIN
                    </code>
                    .
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {customDomainValue
                        ? "Create these records at your DNS provider."
                        : "Example records. Enter and save a hostname above to see your exact values."}
                    </p>

                    <div className="space-y-2">
                      <DnsRecord
                        type="CNAME"
                        purpose="Routes traffic"
                        fields={[
                          { label: "Host", value: dnsHostname },
                          {
                            label: "Target",
                            value: effectiveStatusPageCnameTarget,
                          },
                        ]}
                      />
                      <DnsRecord
                        type="TXT"
                        purpose="Proves ownership"
                        fields={[
                          { label: "Name", value: domainOwnership.name },
                          { label: "Value", value: domainOwnership.value },
                        ]}
                      />
                    </div>

                    <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                      <li>
                        Add both records and keep them on DNS only (no proxy)
                        while verifying.
                      </li>
                      <li>
                        Wait for propagation. The CNAME target must already
                        resolve publicly.
                      </li>
                      <li>
                        Select Verify DNS, then publish the page before opening
                        the URL.
                      </li>
                    </ol>

                    <p className="text-xs text-muted-foreground">
                      Keep the TXT record for future ownership checks.{" "}
                      {STATUS_PAGE_CUSTOM_DOMAIN_RECORD_TYPE_GUIDANCE}
                    </p>
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
          )}
        </CardContent>
      </Card>

      {/* Subscriptions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Subscriptions</CardTitle>
            <InfoHint label="Subscription options">
              <InfoHintText>
                These switches control which subscription options appear on the
                public page. Turning one off hides it without removing existing
                subscribers.
              </InfoHintText>
            </InfoHint>
          </div>
          <CardDescription>
            Choose how visitors can follow updates from this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {subscriptionOptions.map((option) => {
            const Icon = option.icon;
            return (
              <div
                key={option.name}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{option.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                </div>
                <Controller
                  control={control}
                  name={option.name}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!canUpdate}
                      aria-label={`Allow ${option.title.toLowerCase()}`}
                      className="mt-0.5"
                    />
                  )}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Branding</CardTitle>
              <InfoHint label="Branding assets">
                <InfoHintText>
                  The logo and favicon appear on the public page and in
                  subscriber emails. Colors apply to component and incident
                  states.
                </InfoHintText>
              </InfoHint>
            </div>
            <CardDescription className="mt-1.5">
              Logo, favicon, and status colors for the public page.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetBranding}
            disabled={isResetting || !canUpdate}
            title={
              !canUpdate ? "You don't have permission to reset branding" : ""
            }
            className="shrink-0"
          >
            {isResetting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Reset
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center gap-4 rounded-lg border border-dashed p-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                {logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="Page logo preview"
                    width={128}
                    height={128}
                    className="h-full w-full object-contain"
                    unoptimized
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-sm font-medium">Page logo</p>
                  <p className="text-xs text-muted-foreground">
                    630 × 420 px recommended · max 5 MB
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                  onChange={(e) => handleFileChange(e, "logo")}
                  className="peer sr-only"
                  id="logo-upload"
                  disabled={isUploadingLogo || !canUpdate}
                />
                <label
                  htmlFor="logo-upload"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                    (isUploadingLogo || !canUpdate) &&
                      "pointer-events-none opacity-50",
                  )}
                >
                  {isUploadingLogo ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {logoUrl ? "Replace logo" : "Upload logo"}
                </label>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-lg border border-dashed p-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                {faviconUrl ? (
                  <Image
                    src={faviconUrl}
                    alt="Favicon preview"
                    width={64}
                    height={64}
                    className="h-full w-full object-contain"
                    unoptimized
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="text-sm font-medium">Favicon</p>
                  <p className="text-xs text-muted-foreground">
                    96 × 96 px recommended · max 5 MB
                  </p>
                </div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                  onChange={(e) => handleFileChange(e, "favicon")}
                  className="peer sr-only"
                  id="favicon-upload"
                  disabled={isUploadingFavicon || !canUpdate}
                />
                <label
                  htmlFor="favicon-upload"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                    (isUploadingFavicon || !canUpdate) &&
                      "pointer-events-none opacity-50",
                  )}
                >
                  {isUploadingFavicon ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {faviconUrl ? "Replace favicon" : "Upload favicon"}
                </label>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="text-sm font-semibold">Status colors</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              Used for component and incident states on the public page.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {brandColors.map((color) => (
                <div key={color.name} className="space-y-1.5">
                  <Label htmlFor={color.name} className="text-sm font-medium">
                    {color.label}
                  </Label>
                  <div className="flex gap-1.5">
                    <Input
                      id={color.name}
                      type="color"
                      {...register(color.name)}
                      className="h-9 w-10 cursor-pointer p-1"
                      disabled={!canUpdate}
                    />
                    <Input
                      {...register(color.name)}
                      placeholder={color.placeholder}
                      className="flex-1 font-mono text-sm"
                      disabled={!canUpdate}
                      aria-label={`${color.label} hex value`}
                    />
                  </div>
                  {errors[color.name] && (
                    <p className="text-sm text-red-500">
                      {errors[color.name]?.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {isDirty && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2">
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-3 rounded-xl border bg-background/95 p-2 pl-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
          >
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unsaved changes
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => reset()}
                disabled={isSubmitting}
              >
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSubmit(onSubmit)}
                disabled={isSubmitting || !canUpdate}
                title={
                  !canUpdate
                    ? "You don't have permission to save settings"
                    : undefined
                }
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DnsRecord({
  type,
  purpose,
  fields,
}: {
  type: string;
  purpose: string;
  fields: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="font-mono text-xs font-medium">{type}</span>
        <span className="text-[11px] text-muted-foreground">{purpose}</span>
      </div>
      <dl className="divide-y">
        {fields.map((field) => (
          <div
            key={field.label}
            className="flex items-start justify-between gap-3 px-3 py-2"
          >
            <dt className="w-14 shrink-0 text-xs text-muted-foreground">
              {field.label}
            </dt>
            <dd className="min-w-0 flex-1 text-right">
              <code className="break-all font-mono text-xs">{field.value}</code>
            </dd>
            <CopyButton
              value={field.value}
              className="mt-0.5 shrink-0 opacity-100"
            />
          </div>
        ))}
      </dl>
    </div>
  );
}
