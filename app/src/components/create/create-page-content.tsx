"use client";
import React, { useState, useCallback } from "react";
import { CreateCard } from "./create-card";
import { useRouter } from "next/navigation";
import { Video, Variable, Shield, Tally4, Chrome } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { monitorTypes } from "@/components/monitors/data";
import { types } from "@/components/tests/data";
import { K6Logo } from "@/components/logo/k6-logo";
import { PlaywrightLogo } from "@/components/logo/playwright-logo";
import { notificationProviders } from "@/components/alerts/data";

type ScriptType = "browser" | "api" | "custom" | "database" | "performance" | "record";

// Extension URLs
const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/supercheck-recorder/gfmbcelfhhfmifdkccnbgdadibdfhioe";
const EDGE_ADDONS_URL = "https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder/ngmlkgfgmdnfpddohcbfdgihennolnem";

// Detect browser type
function detectBrowser(): 'chrome' | 'edge' | 'unsupported' {
  if (typeof navigator === 'undefined') return 'unsupported';

  const userAgent = navigator.userAgent.toLowerCase();

  // Edge uses "edg" in user agent
  if (userAgent.includes('edg')) return 'edge';

  // Chrome - must check after Edge since Edge also contains Chrome
  // Most Chromium browsers (Brave, Vivaldi, etc.) include "Chrome" in UA
  if (userAgent.includes('chrome') && !userAgent.includes('edg')) return 'chrome';

  // All other browsers (Safari, Firefox, etc.) are unsupported
  return 'unsupported';
}

export function CreatePageContent() {
  const router = useRouter();
  const [showUnsupportedDialog, setShowUnsupportedDialog] = useState(false);

  const testTypes = [
    ...types.map((type) => ({
      icon: <type.icon size={20} className={type.color} />,
      title: type.label,
      path: `/playground?scriptType=${type.value}`,
      scriptType: type.value as ScriptType,
    })),
    {
      icon: <Video size={20} className="text-red-500" />,
      title: "Record",
      path: "", // Handled by custom onClick
      scriptType: "record" as ScriptType,
    },
  ];

  const handleRecordClick = useCallback(() => {
    const browser = detectBrowser();

    if (browser === 'unsupported') {
      setShowUnsupportedDialog(true);
      return;
    }

    const url = browser === 'edge' ? EDGE_ADDONS_URL : CHROME_WEB_STORE_URL;
    window.open(url, '_blank');
  }, []);

  const jobTypes = [
    {
      icon: <PlaywrightLogo width={20} height={20} />,
      title: "Playwright Job",
      onClick: () => router.push("/jobs/create/playwright"),
    },
    {
      icon: <K6Logo width={20} height={20} />,
      title: "k6 Performance Job",
      onClick: () => router.push("/jobs/create/k6"),
    },
  ];

  const variableTypes = [
    {
      icon: <Variable size={20} className="text-cyan-500" />,
      title: "Variable",
      onClick: () => router.push("/variables?create=true"),
    },
    {
      icon: <Shield size={20} className="text-red-500" />,
      title: "Secret",
      onClick: () => router.push("/variables?create=true&type=secret"),
    },
  ];

  const statusPageTypes = [
    {
      icon: <Tally4 size={20} className="text-green-600" />,
      title: "Status Page",
      onClick: () => router.push("/status-pages?create=true"),
    },
  ];

  const notificationTypes = notificationProviders.map((provider) => {
    const IconComponent = provider.icon;
    return {
      icon: <IconComponent size={20} className={provider.color} />,
      title: provider.label,
      onClick: () => router.push(`/alerts?create=true&type=${provider.type}`),
    };
  });

  return (
    <div className="mx-auto p-4 mt-3">
      <div className="mb-3 pl-1">
        <h2 className="text-md font-semibold">Create New Test</h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Select the type of test you want to create
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {testTypes.map((testType) => (
          <CreateCard
            key={testType.scriptType || testType.title}
            icon={testType.icon}
            title={testType.title}
            onClick={() =>
              testType.title === "Record"
                ? handleRecordClick()
                : router.push(testType.path)
            }
            className={testType.title === "Record" ? "border-dashed" : ""}
          />
        ))}
      </div>

      {/* Unsupported Browser Dialog */}
      <Dialog open={showUnsupportedDialog} onOpenChange={setShowUnsupportedDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40">
                <Chrome className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <span>Browser Not Supported</span>
            </DialogTitle>
            <DialogDescription>
              The Supercheck Recorder extension requires a Chromium-based browser
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
              <p className="text-sm font-medium">Supported Browsers:</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Chrome className="h-5 w-5 text-sky-500" />
                  <span className="text-sm">Google Chrome</span>
                </div>
                <div className="flex items-center gap-2">
                  <Chrome className="h-5 w-5 text-blue-500" />
                  <span className="text-sm">Microsoft Edge</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Also compatible with Brave, Opera, Vivaldi, and other Chromium-based browsers.
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              Please open Supercheck in a Chromium-based browser to use the browser recording feature.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnsupportedDialog(false)} className="w-full">
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-6 mb-3 pl-1">
        <h2 className="text-md font-semibold">Create New Job</h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Configure a new automated or manual job
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {jobTypes.map((jobType) => (
          <CreateCard
            key={jobType.title}
            icon={jobType.icon}
            title={jobType.title}
            onClick={jobType.onClick}
          />
        ))}
      </div>

      <div className="mt-6 mb-3 pl-1">
        <h2 className="text-md font-semibold">Create New Monitor</h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Select the type of uptime monitor you want to create
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {monitorTypes.map((monitorType) => {
          const IconComponent = monitorType.icon;
          return (
            <CreateCard
              key={monitorType.value}
              icon={<IconComponent size={20} className={monitorType.color} />}
              title={monitorType.label}
              onClick={() =>
                router.push(`/monitors/create?type=${monitorType.value}`)
              }
            />
          );
        })}
      </div>

      <div className="mt-6 mb-3 pl-1">
        <h2 className="text-md font-semibold">Create Status Page</h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Create and manage public status pages for your services
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {statusPageTypes.map((statusPageType) => (
          <CreateCard
            key={statusPageType.title}
            icon={statusPageType.icon}
            title={statusPageType.title}
            onClick={statusPageType.onClick}
          />
        ))}
      </div>

      <div className="mt-6 mb-3 pl-1">
        <h2 className="text-md font-semibold">Create Variables & Secrets</h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Configure environment variables and secure secrets
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {variableTypes.map((variableType) => (
          <CreateCard
            key={variableType.title}
            icon={variableType.icon}
            title={variableType.title}
            onClick={variableType.onClick}
          />
        ))}
      </div>

      <div className="mt-6 mb-3 pl-1">
        <h2 className="text-md font-semibold">Create Notification Provider</h2>
        <p className="text-muted-foreground text-sm mt-0.5">
          Configure alert notifications and view delivery history
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-2">
        {notificationTypes.map((notificationType) => (
          <CreateCard
            key={notificationType.title}
            icon={notificationType.icon}
            title={notificationType.title}
            onClick={notificationType.onClick}
          />
        ))}
      </div>
    </div>
  );
}
