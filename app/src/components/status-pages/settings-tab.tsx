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
  Info,
  Mail,
  Webhook,
  MessageSquare,
  Rss,
} from "lucide-react";
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
import { useAppConfig } from "@/hooks/use-app-config";

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
  supportUrl: z
    .string()
    .url("Please enter a valid URL")
    .optional()
    .or(z.literal("")),
  customDomain: z
    .string()
    .max(255)
    .regex(
      /^$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
      "Invalid domain format"
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
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export function SettingsTab({ statusPage, canUpdate }: SettingsTabProps) {
  const router = useRouter();
  const [isResetting, setIsResetting] = useState(false);
  const [isVerifyingDNS, setIsVerifyingDNS] = useState(false);
  const { statusPageDomain } = useAppConfig();

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
    setValue,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: statusPage.name,
      headline: statusPage.headline || "",
      pageDescription: statusPage.pageDescription || "",
      supportUrl: statusPage.supportUrl || "",
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
    },
  });

  const customDomainValue = watch("customDomain");

  const onSubmit = async (data: SettingsFormValues) => {
    try {
      const result = await updateStatusPageSettings({
        statusPageId: statusPage.id,
        ...data,
        headline: data.headline || undefined,
        pageDescription: data.pageDescription || undefined,
        supportUrl: data.supportUrl || undefined,
        customDomain: data.customDomain || undefined,
      });

      if (result.success) {
        toast.success("Settings saved successfully");
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
        // Reset form values
        setValue("cssGreens", "#2ecc71", { shouldDirty: true });
        setValue("cssYellows", "#f1c40f", { shouldDirty: true });
        setValue("cssOranges", "#e67e22", { shouldDirty: true });
        setValue("cssBlues", "#3498db", { shouldDirty: true });
        setValue("cssReds", "#e74c3c", { shouldDirty: true });

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
        }
      );

      const result = await response.json();

      if (result.success) {
        toast.success(
          `${type === "logo" ? "Logo" : "Favicon"} uploaded successfully`
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
    type: "logo" | "favicon"
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
          "Please upload a valid image file (PNG, JPG, GIF, SVG, or WebP)"
        );
        return;
      }

      handleFileUpload(file, type);
    }
  };

  return (
    <div className="space-y-5 relative">
      {/* Save Button */}
      <div className="absolute -top-15 right-2">
        <Button
          onClick={handleSubmit(onSubmit)}
          disabled={isSubmitting || !canUpdate || !isDirty}
          title={
            !canUpdate
              ? "You don't have permission to save settings"
              : !isDirty
                ? "No changes to save"
                : ""
          }
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Settings
        </Button>
      </div>

      {/* General Settings & Configuration Card - Combined */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Settings</CardTitle>
          </div>
          <CardDescription>
            Configure your status page information, domain, and subscriptions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Information Section */}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              Basic Information
            </h4>
            <div className="grid gap-4 md:grid-cols-2">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Page Name
                </Label>
                <Input
                  id="name"
                  {...register("name")}
                  placeholder="My Status Page"
                  disabled={!canUpdate}
                />
                {errors.name && (
                  <p className="text-sm text-red-500">{errors.name.message}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  Internal name for your reference
                </p>
              </div>

              {/* Headline */}
              <div className="space-y-2">
                <Label htmlFor="headline" className="text-sm font-medium">
                  Headline
                </Label>
                <Input
                  id="headline"
                  {...register("headline")}
                  placeholder="System Status"
                  maxLength={255}
                  disabled={!canUpdate}
                />
                {errors.headline && (
                  <p className="text-sm text-red-500">
                    {errors.headline.message}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Display heading on your public status page
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium">
                  Description
                </Label>
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

              {/* Support URL */}
              <div className="space-y-2">
                <Label htmlFor="supportUrl" className="text-sm font-medium">
                  Support URL
                </Label>
                <Input
                  id="supportUrl"
                  type="url"
                  {...register("supportUrl")}
                  placeholder="https://support.example.com"
                  disabled={!canUpdate}
                />
                {errors.supportUrl && (
                  <p className="text-sm text-red-500">
                    {errors.supportUrl.message}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Link to your support page or contact info
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Domain & Subscriptions Section */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Custom Domain */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Custom Domain
              </h4>
              <p className="text-sm text-muted-foreground">
                Use your own domain for your status page. SSL certificates are
                automatically provisioned and renewed.
              </p>
              <div className="flex gap-2 mt-5">
                <Input
                  placeholder="status.yourcompany.com"
                  {...register("customDomain")}
                  disabled={!canUpdate}
                  className="font-mono text-sm"
                />
                {customDomainValue &&
                  customDomainValue !== statusPage.customDomain && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={true}
                      title="Save changes first"
                    >
                      Save First
                    </Button>
                  )}
                {customDomainValue &&
                  customDomainValue === statusPage.customDomain && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleVerifyDNS}
                      disabled={isVerifyingDNS || !canUpdate}
                    >
                      {isVerifyingDNS ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Verify DNS"
                      )}
                    </Button>
                  )}
              </div>
              {errors.customDomain && (
                <p className="text-sm text-red-500">
                  {errors.customDomain.message}
                </p>
              )}

              {statusPage.customDomainVerified &&
                customDomainValue === statusPage.customDomain && (
                  <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950 p-2 rounded">
                    <CheckCircle2 className="h-4 w-4" />
                    Domain verified and active
                  </div>
                )}
              {!statusPage.customDomainVerified &&
                customDomainValue &&
                customDomainValue === statusPage.customDomain && (
                  <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950 p-2 rounded">
                    <AlertTriangle className="h-4 w-4" />
                    <span>Waiting for DNS verification...</span>
                  </div>
                )}

              <div className="space-y-1.5 mt-6 text-sm text-muted-foreground bg-muted/30 rounded-md p-3 border">
                <div className="flex items-start gap-2">
                  <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <div className="space-y-3">
                    <div>
                      <span className="font-medium text-foreground/80">
                        Setup instructions:
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div>• Add a CNAME record in your DNS provider</div>
                      <div>
                        • Record Name:{" "}
                        <code className="bg-muted px-1 py-0.5 rounded text-sm">
                          status
                        </code>{" "}
                        (for status.yourcompany.com)
                      </div>
                      <div>
                        • Points to:{" "}
                        <code className="bg-muted px-1 py-0.5 rounded text-sm">
                          {statusPageDomain}
                        </code>
                      </div>
                      <div>• Wait 15-30 minutes for DNS propagation</div>
                      <div>• Click &quot;Verify DNS&quot; to confirm the setup</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Subscriptions */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                Subscriptions
              </h4>
              <div className="space-y-2">
                {/* Page Subscriptions */}
                <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-1.5 bg-primary/10 rounded">
                      <Bell className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        Page Subscriptions
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Allow visitors to subscribe to all status updates
                      </div>
                    </div>
                  </div>
                  <Controller
                    control={control}
                    name="allowPageSubscribers"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canUpdate}
                        className="ml-3"
                      />
                    )}
                  />
                </div>

                {/* Email Notifications */}
                <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-1.5 bg-blue-500/10 rounded">
                      <Mail className="h-4 w-4 text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        Email Notifications
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Send email alerts for incidents and updates
                      </div>
                    </div>
                  </div>
                  <Controller
                    control={control}
                    name="allowEmailSubscribers"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canUpdate}
                        className="ml-3"
                      />
                    )}
                  />
                </div>

                {/* Webhook Notifications */}
                <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-1.5 bg-orange-500/10 rounded">
                      <Webhook className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        Webhook Notifications
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Trigger webhooks for status changes and incidents
                      </div>
                    </div>
                  </div>
                  <Controller
                    control={control}
                    name="allowWebhookSubscribers"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canUpdate}
                        className="ml-3"
                      />
                    )}
                  />
                </div>

                {/* Slack Notifications */}
                <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-1.5 bg-purple-500/10 rounded">
                      <MessageSquare className="h-4 w-4 text-purple-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        Slack Notifications
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Send updates to Slack channels via webhooks
                      </div>
                    </div>
                  </div>
                  <Controller
                    control={control}
                    name="allowSlackSubscribers"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canUpdate}
                        className="ml-3"
                      />
                    )}
                  />
                </div>

                {/* Incident Subscriptions */}
                <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-1.5 bg-red-500/10 rounded">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        Incident Subscriptions
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Enable subscriptions to specific incident updates
                      </div>
                    </div>
                  </div>
                  <Controller
                    control={control}
                    name="allowIncidentSubscribers"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canUpdate}
                        className="ml-3"
                      />
                    )}
                  />
                </div>

                {/* RSS Feed */}
                <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-1.5 bg-amber-500/10 rounded">
                      <Rss className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">RSS Feed</div>
                      <div className="text-xs text-muted-foreground">
                        Provide an RSS feed for automated monitoring tools
                      </div>
                    </div>
                  </div>
                  <Controller
                    control={control}
                    name="allowRssFeed"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canUpdate}
                        className="ml-3"
                      />
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Page Branding Card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Page Branding</CardTitle>
            </div>
            <CardDescription className="mt-1.5">
              Customize the look and feel of your status page
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
          >
            {isResetting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Reset Branding to Defaults
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Logo and Favicon Upload */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">Upload Assets</h4>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {/* Page Logo */}
              <div className="space-y-2">
                <Label className="text-sm">Page logo</Label>
                <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                  {logoUrl && (
                    <div className="mb-3">
                      <Image
                        src={logoUrl}
                        alt="Page logo preview"
                        width={200}
                        height={96}
                        className="max-h-24 mx-auto object-contain"
                        unoptimized
                      />
                    </div>
                  )}
                  <p className="text-sm text-blue-600 mb-1">
                    {logoUrl ? "Change logo" : "Upload logo"}
                  </p>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                    onChange={(e) => handleFileChange(e, "logo")}
                    className="hidden"
                    id="logo-upload"
                    disabled={isUploadingLogo}
                  />
                  <label htmlFor="logo-upload">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      disabled={isUploadingLogo || !canUpdate}
                      asChild
                      title={
                        !canUpdate ? "You don't have permission to upload" : ""
                      }
                    >
                      <span className="cursor-pointer">
                        {isUploadingLogo ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          "Upload image"
                        )}
                      </span>
                    </Button>
                  </label>
                  <p className="text-sm text-muted-foreground mt-2">
                    Recommended size: 630px x 420px (Max 5MB)
                  </p>
                </div>
              </div>

              {/* Fav Icon */}
              <div className="space-y-2">
                <Label className="text-sm">Fav icon</Label>
                <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                  {faviconUrl && (
                    <div className="mb-3">
                      <Image
                        src={faviconUrl}
                        alt="Favicon preview"
                        width={96}
                        height={96}
                        className="max-h-24 mx-auto object-contain"
                        unoptimized
                      />
                    </div>
                  )}
                  <p className="text-sm text-blue-600 mb-1">
                    {faviconUrl ? "Change favicon" : "Upload favicon"}
                  </p>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                    onChange={(e) => handleFileChange(e, "favicon")}
                    className="hidden"
                    id="favicon-upload"
                    disabled={isUploadingFavicon}
                  />
                  <label htmlFor="favicon-upload">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      disabled={isUploadingFavicon || !canUpdate}
                      asChild
                      title={
                        !canUpdate ? "You don't have permission to upload" : ""
                      }
                    >
                      <span className="cursor-pointer">
                        {isUploadingFavicon ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          "Upload image"
                        )}
                      </span>
                    </Button>
                  </label>
                  <p className="text-sm text-muted-foreground mt-2">
                    Recommended size: 96px x 96px (Max 5MB)
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Branding Colors */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">Status Colors</h4>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Customize the colors used on your status page to match your brand
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cssGreens" className="text-sm font-medium">
                  Operational
                </Label>
                <div className="flex gap-1.5">
                  <Input
                    id="cssGreens"
                    type="color"
                    {...register("cssGreens")}
                    className="w-10 h-9 p-1 cursor-pointer"
                    disabled={!canUpdate}
                  />
                  <Input
                    {...register("cssGreens")}
                    placeholder="#2ecc71"
                    className="flex-1 font-mono text-sm"
                    disabled={!canUpdate}
                  />
                </div>
                {errors.cssGreens && (
                  <p className="text-sm text-red-500">
                    {errors.cssGreens.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssYellows" className="text-sm font-medium">
                  Degraded
                </Label>
                <div className="flex gap-1.5">
                  <Input
                    id="cssYellows"
                    type="color"
                    {...register("cssYellows")}
                    className="w-10 h-9 p-1 cursor-pointer"
                    disabled={!canUpdate}
                  />
                  <Input
                    {...register("cssYellows")}
                    placeholder="#f1c40f"
                    className="flex-1 font-mono text-sm"
                    disabled={!canUpdate}
                  />
                </div>
                {errors.cssYellows && (
                  <p className="text-sm text-red-500">
                    {errors.cssYellows.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssOranges" className="text-sm font-medium">
                  Partial Outage
                </Label>
                <div className="flex gap-1.5">
                  <Input
                    id="cssOranges"
                    type="color"
                    {...register("cssOranges")}
                    className="w-10 h-9 p-1 cursor-pointer"
                    disabled={!canUpdate}
                  />
                  <Input
                    {...register("cssOranges")}
                    placeholder="#e67e22"
                    className="flex-1 font-mono text-sm"
                    disabled={!canUpdate}
                  />
                </div>
                {errors.cssOranges && (
                  <p className="text-sm text-red-500">
                    {errors.cssOranges.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssBlues" className="text-sm font-medium">
                  Maintenance
                </Label>
                <div className="flex gap-1.5">
                  <Input
                    id="cssBlues"
                    type="color"
                    {...register("cssBlues")}
                    className="w-10 h-9 p-1 cursor-pointer"
                    disabled={!canUpdate}
                  />
                  <Input
                    {...register("cssBlues")}
                    placeholder="#3498db"
                    className="flex-1 font-mono text-sm"
                    disabled={!canUpdate}
                  />
                </div>
                {errors.cssBlues && (
                  <p className="text-sm text-red-500">
                    {errors.cssBlues.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssReds" className="text-sm font-medium">
                  Major Outage
                </Label>
                <div className="flex gap-1.5">
                  <Input
                    id="cssReds"
                    type="color"
                    {...register("cssReds")}
                    className="w-10 h-9 p-1 cursor-pointer"
                    disabled={!canUpdate}
                  />
                  <Input
                    {...register("cssReds")}
                    placeholder="#e74c3c"
                    className="flex-1 font-mono text-sm"
                    disabled={!canUpdate}
                  />
                </div>
                {errors.cssReds && (
                  <p className="text-sm text-red-500">
                    {errors.cssReds.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
