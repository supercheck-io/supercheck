"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Save, RotateCcw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  updateStatusPageSettings,
  resetBrandingToDefaults,
} from "@/actions/update-status-page-settings";
import { useRouter } from "next/navigation";

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
  allowIncidentSubscribers: boolean | null;
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

export function SettingsTab({ statusPage, canUpdate }: SettingsTabProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Upload states
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const [logoUrl, setLogoUrl] = useState(statusPage.transactionalLogo || null);
  const [faviconUrl, setFaviconUrl] = useState(statusPage.faviconLogo || null);

  // General settings
  const [name, setName] = useState(statusPage.name);
  const [headline, setHeadline] = useState(statusPage.headline || "");
  const [description, setDescription] = useState(
    statusPage.pageDescription || ""
  );
  const [supportUrl, setSupportUrl] = useState(statusPage.supportUrl || "");

  // Custom domain
  const [customDomain, setCustomDomain] = useState(
    statusPage.customDomain || ""
  );

  // Subscriber settings
  const [allowPageSubscribers, setAllowPageSubscribers] = useState(
    statusPage.allowPageSubscribers ?? true
  );
  const [allowEmailSubscribers, setAllowEmailSubscribers] = useState(
    statusPage.allowEmailSubscribers ?? true
  );

  // Branding colors
  const [cssGreens, setCssGreens] = useState(statusPage.cssGreens || "#2ecc71");
  const [cssYellows, setCssYellows] = useState(
    statusPage.cssYellows || "#f1c40f"
  );
  const [cssOranges, setCssOranges] = useState(
    statusPage.cssOranges || "#e67e22"
  );
  const [cssBlues, setCssBlues] = useState(statusPage.cssBlues || "#3498db");
  const [cssReds, setCssReds] = useState(statusPage.cssReds || "#e74c3c");

  // Check if form has changes
  const hasChanges =
    name !== statusPage.name ||
    headline !== (statusPage.headline || "") ||
    description !== (statusPage.pageDescription || "") ||
    supportUrl !== (statusPage.supportUrl || "") ||
    customDomain !== (statusPage.customDomain || "") ||
    allowPageSubscribers !== (statusPage.allowPageSubscribers ?? true) ||
    allowEmailSubscribers !== (statusPage.allowEmailSubscribers ?? true) ||
    cssGreens !== (statusPage.cssGreens || "#2ecc71") ||
    cssYellows !== (statusPage.cssYellows || "#f1c40f") ||
    cssOranges !== (statusPage.cssOranges || "#e67e22") ||
    cssBlues !== (statusPage.cssBlues || "#3498db") ||
    cssReds !== (statusPage.cssReds || "#e74c3c");

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const result = await updateStatusPageSettings({
        statusPageId: statusPage.id,
        name,
        headline: headline || undefined,
        pageDescription: description || undefined,
        supportUrl: supportUrl || undefined,
        customDomain: customDomain || undefined,
        allowPageSubscribers,
        allowEmailSubscribers,
        cssGreens,
        cssYellows,
        cssOranges,
        cssBlues,
        cssReds,
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
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetBranding = async () => {
    setIsResetting(true);

    try {
      const result = await resetBrandingToDefaults(statusPage.id);

      if (result.success) {
        toast.success("Branding reset to defaults");
        // Reset local state
        setCssGreens("#2ecc71");
        setCssYellows("#f1c40f");
        setCssOranges("#e67e22");
        setCssBlues("#3498db");
        setCssReds("#e74c3c");
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
    <div className="p-6 space-y-5 relative">
      {/* Save Button */}
      <div className="absolute -top-8 right-6">
        <Button
          onClick={handleSave}
          disabled={isSaving || !canUpdate || !hasChanges}
          title={
            !canUpdate
              ? "You don't have permission to save settings"
              : !hasChanges
                ? "No changes to save"
                : ""
          }
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Settings
        </Button>
      </div>

      {/* General Settings Card - Two Columns */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">General Settings</CardTitle>
          <CardDescription>
            Configure basic information about your status page
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Left Column */}
            <div className="space-y-4">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Page Name
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Status Page"
                  disabled={!canUpdate}
                />
                <p className="text-xs text-muted-foreground">
                  Internal name for your reference (not visible to public)
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your services and what this status page tracks..."
                  disabled={!canUpdate}
                  className="resize-none"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to users visiting your status page
                </p>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              {/* Headline */}
              <div className="space-y-2">
                <Label htmlFor="headline" className="text-sm font-medium">
                  Headline
                </Label>
                <Input
                  id="headline"
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="System Status"
                  maxLength={255}
                  disabled={!canUpdate}
                />
                <p className="text-xs text-muted-foreground">
                  Display heading on your public status page
                </p>
              </div>

              {/* Support URL */}
              <div className="space-y-2">
                <Label htmlFor="supportUrl" className="text-sm font-medium">
                  Support URL
                </Label>
                <Input
                  id="supportUrl"
                  type="url"
                  value={supportUrl}
                  onChange={(e) => setSupportUrl(e.target.value)}
                  placeholder="https://support.example.com"
                  disabled={!canUpdate}
                />
                <p className="text-xs text-muted-foreground">
                  Link to your support page or contact info
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Card - Two Column Layout */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
          <CardDescription>
            Domain, subscriptions, and notification settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Left Column: Custom Domain */}
            <div className="space-y-4">
              {/* Custom Domain */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Custom Domain</Label>
                  <p className="text-xs text-muted-foreground">
                    Use your own domain for the status page
                  </p>
                </div>
                <Input
                  placeholder="status.yourcompany.com"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  disabled={!canUpdate}
                  className="font-mono text-sm"
                />
                {statusPage.customDomainVerified &&
                  customDomain === statusPage.customDomain && (
                    <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950 p-2 rounded">
                      <CheckCircle2 className="h-4 w-4" />
                      Domain verified and active
                    </div>
                  )}
                {!statusPage.customDomainVerified && customDomain && (
                  <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950 p-2 rounded">
                    ⏳ Waiting for DNS verification...
                  </div>
                )}

                {/* Custom Domain Setup Instructions */}
                <div className="text-xs text-muted-foreground space-y-1 mt-3">
                  <p>
                    <span className="font-medium">1.</span> Enter your domain
                    (e.g., status.yourcompany.com)
                  </p>
                  <p>
                    <span className="font-medium">2.</span> Add CNAME record
                    pointing to: supercheck.io
                  </p>
                  <p>
                    <span className="font-medium">3.</span> Wait for DNS
                    propagation (usually 15-30 minutes. We&apos;ll verify
                    automatically.)
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Subscriptions */}
            <div className="space-y-4">
              {/* Subscription Settings */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Subscriptions</Label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">
                        Allow Page Subscriptions
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Let users subscribe for updates
                      </p>
                    </div>
                    <Switch
                      checked={allowPageSubscribers}
                      onCheckedChange={setAllowPageSubscribers}
                      disabled={!canUpdate}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">Email Subscriptions</p>
                      <p className="text-xs text-muted-foreground">
                        Send updates via email
                      </p>
                    </div>
                    <Switch
                      checked={allowEmailSubscribers}
                      onCheckedChange={setAllowEmailSubscribers}
                      disabled={!canUpdate}
                    />
                  </div>
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
            <CardTitle className="text-lg">Page Branding</CardTitle>
            <CardDescription>
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
            <h4 className="text-sm font-semibold mb-3">Upload Assets</h4>
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
                  <p className="text-xs text-muted-foreground mt-2">
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
                  <p className="text-xs text-muted-foreground mt-2">
                    Recommended size: 96px x 96px (Max 5MB)
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Branding Colors */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Branding Colors</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Customize the colors used on your status page to match your brand
            </p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="cssGreens" className="text-sm">
                  Operational (Green)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cssGreens"
                    type="color"
                    value={cssGreens}
                    onChange={(e) => setCssGreens(e.target.value)}
                    className="w-14 h-9 p-1"
                  />
                  <Input
                    value={cssGreens}
                    onChange={(e) => setCssGreens(e.target.value)}
                    placeholder="#2ecc71"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssYellows" className="text-sm">
                  Degraded (Yellow)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cssYellows"
                    type="color"
                    value={cssYellows}
                    onChange={(e) => setCssYellows(e.target.value)}
                    className="w-14 h-9 p-1"
                  />
                  <Input
                    value={cssYellows}
                    onChange={(e) => setCssYellows(e.target.value)}
                    placeholder="#f1c40f"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssOranges" className="text-sm">
                  Partial Outage (Orange)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cssOranges"
                    type="color"
                    value={cssOranges}
                    onChange={(e) => setCssOranges(e.target.value)}
                    className="w-14 h-9 p-1"
                  />
                  <Input
                    value={cssOranges}
                    onChange={(e) => setCssOranges(e.target.value)}
                    placeholder="#e67e22"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssBlues" className="text-sm">
                  Maintenance (Blue)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cssBlues"
                    type="color"
                    value={cssBlues}
                    onChange={(e) => setCssBlues(e.target.value)}
                    className="w-14 h-9 p-1"
                  />
                  <Input
                    value={cssBlues}
                    onChange={(e) => setCssBlues(e.target.value)}
                    placeholder="#3498db"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cssReds" className="text-sm">
                  Major Outage (Red)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="cssReds"
                    type="color"
                    value={cssReds}
                    onChange={(e) => setCssReds(e.target.value)}
                    className="w-14 h-9 p-1"
                  />
                  <Input
                    value={cssReds}
                    onChange={(e) => setCssReds(e.target.value)}
                    placeholder="#e74c3c"
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
