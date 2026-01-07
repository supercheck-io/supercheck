"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Video, Download, ExternalLink, RefreshCw, MousePointerClick, Circle, Chrome } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { CheckIcon } from "@/components/logo/supercheck-logo";

interface RecordButtonProps {
  projectId: string;
  requirementId?: string;
  testName?: string;
  targetUrl?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  children?: React.ReactNode;
}

// Extension API interface exposed by content script
interface SuperCheckRecorderAPI {
  version: string;
  isConnected: () => Promise<boolean>;
  storeRecordingContext: (payload: Record<string, unknown>) => Promise<void>;
}

// Get the extension API from window (set by content script)
function getExtensionAPI(): SuperCheckRecorderAPI | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).__SUPERCHECK_RECORDER__ || null;
}

// Detect browser type
function detectBrowser(): 'chrome' | 'edge' | 'unsupported' {
  if (typeof navigator === 'undefined') return 'unsupported';

  const userAgent = navigator.userAgent.toLowerCase();

  // Edge uses "edg" in user agent
  if (userAgent.includes('edg')) return 'edge';

  // Chrome - must check after Edge since Edge also contains Chrome
  if (userAgent.includes('chrome') && !userAgent.includes('edg')) return 'chrome';

  // All other browsers (Safari, Firefox, etc.) are unsupported
  return 'unsupported';
}

// Extension URLs
const CHROME_WEB_STORE_URL = "https://chrome.google.com/webstore/detail/supercheck-recorder";
const EDGE_ADDONS_URL = "https://microsoftedge.microsoft.com/addons/detail/supercheck-recorder";
const EXTENSION_DOCS_URL = "https://docs.supercheck.io/recorder";

export function RecordButton({
  projectId,
  requirementId,
  testName,
  targetUrl,
  variant = "default",
  size = "default",
  className,
  children,
}: RecordButtonProps) {
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const [showClickExtensionDialog, setShowClickExtensionDialog] = useState(false);
  const [showUnsupportedDialog, setShowUnsupportedDialog] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [browser] = useState(() => detectBrowser());

  const handleClick = useCallback(async () => {
    setIsStarting(true);

    try {
      // Check if browser is supported
      if (browser === 'unsupported') {
        console.log("[RecordButton] Unsupported browser detected");
        setShowUnsupportedDialog(true);
        setIsStarting(false);
        return;
      }

      // Check if extension API is available on window
      const api = getExtensionAPI();

      if (!api) {
        // Extension not installed or content script not loaded
        console.log("[RecordButton] Extension API not found on window");
        setShowInstallDialog(true);
        setIsStarting(false);
        return;
      }

      // Verify the extension can communicate with its background
      const isConnected = await api.isConnected();

      if (!isConnected) {
        // Extension is installed but orphaned (needs page refresh)
        console.log("[RecordButton] Extension API found but disconnected from background");
        setShowRefreshDialog(true);
        setIsStarting(false);
        return;
      }

      // Store recording context in extension
      // User will then click extension icon to start recording (required for side panel)
      console.log("[RecordButton] Storing recording context in extension");
      await api.storeRecordingContext({
        projectId,
        requirementId,
        testName: testName || `Recording ${new Date().toLocaleString()}`,
        targetUrl: targetUrl || 'about:blank',
        returnUrl: window.location.href,
      });

      // Show the instruction modal telling user to click extension icon
      setShowClickExtensionDialog(true);
      console.log("[RecordButton] Recording context stored, showing instruction modal");
    } catch (error) {
      console.error("[RecordButton] Failed to prepare recording:", error);
      // If we got an error, show install dialog as fallback
      setShowInstallDialog(true);
    } finally {
      setIsStarting(false);
    }
  }, [projectId, requirementId, testName, targetUrl, browser]);

  // Get the install URL based on current browser
  const getInstallUrl = () => {
    if (browser === 'edge') return EDGE_ADDONS_URL;
    return CHROME_WEB_STORE_URL;
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        className={className}
        disabled={isStarting}
      >
        {children || (
          <>
            <Video className="mr-2 h-4 w-4" />
            {isStarting ? "Preparing..." : "Record Browser Test"}
          </>
        )}
      </Button>

      {/* Install Extension Dialog */}
      <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/40">
                <Circle className="h-4 w-4 text-red-600 dark:text-red-400 fill-current" />
              </div>
              <span>Install Supercheck Recorder</span>
            </DialogTitle>
            <DialogDescription>
              Record browser interactions directly from {browser === 'edge' ? 'Edge' : 'Chrome'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Supported browsers notice */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <Chrome className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-700 dark:text-green-400">
                ✓ Supported in <strong>Chrome</strong> and <strong>Edge</strong>
              </span>
            </div>

            <div className="rounded-lg border bg-muted/50 p-4">
              <ol className="text-sm space-y-2">
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0">1</span>
                  <span>Install the {browser === 'edge' ? 'Edge' : 'Chrome'} extension</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0">2</span>
                  <span>Refresh this page</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0">3</span>
                  <span>Click the record button to start</span>
                </li>
              </ol>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowInstallDialog(false)}>
              Cancel
            </Button>
            <Button asChild>
              <a
                href={getInstallUrl()}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="mr-2 h-4 w-4" />
                Install for {browser === 'edge' ? 'Edge' : 'Chrome'}
                <ExternalLink className="ml-2 h-3 w-3" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refresh Required Dialog - shown when extension was updated */}
      <Dialog open={showRefreshDialog} onOpenChange={setShowRefreshDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <RefreshCw className="h-8 w-8 text-amber-500" />
              <span>Page Refresh Required</span>
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              The Supercheck Recorder extension was recently updated. Please refresh this page to reconnect.
            </p>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowRefreshDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Click Extension Dialog - shown after recording context is stored */}
      <Dialog open={showClickExtensionDialog} onOpenChange={setShowClickExtensionDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/40">
                <Circle className="h-4 w-4 text-red-600 dark:text-red-400 fill-current animate-pulse" />
              </div>
              <span>Start Recording</span>
            </DialogTitle>
            <DialogDescription>
              Click the extension icon in your browser toolbar to begin recording
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Visual click instruction */}
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4">
                <MousePointerClick className="h-6 w-6 text-primary animate-pulse" />
                <div className="flex items-center gap-2 rounded-md bg-background border px-3 py-2 shadow-sm">
                  <CheckIcon className="h-5 w-5" />
                  <span className="text-sm font-medium">Supercheck Recorder</span>
                </div>
              </div>
            </div>

            {/* Info card */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0 mt-0.5">1</span>
                <span className="text-sm text-muted-foreground">
                  Look for the <strong className="text-foreground">Supercheck icon</strong> in your browser&apos;s extension area
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0 mt-0.5">2</span>
                <span className="text-sm text-muted-foreground">
                  Recording starts in a <strong className="text-foreground">new tab</strong>
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0 mt-0.5">3</span>
                <span className="text-sm text-muted-foreground">
                  Click <strong className="text-foreground">Save to Playground</strong> when done
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClickExtensionDialog(false)} className="w-full">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            </div>

            <p className="text-sm text-muted-foreground">
              Please open SuperCheck in Chrome or Edge to use the browser recording feature.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnsupportedDialog(false)} className="w-full">
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

