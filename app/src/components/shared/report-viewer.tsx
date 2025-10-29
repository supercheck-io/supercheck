import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2Icon, FileText, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PlaywrightLogo } from "../logo/playwright-logo";
import { TimeoutErrorPage } from "./timeout-error-page";
import { TimeoutErrorInfo } from "@/lib/timeout-utils";

interface ReportViewerProps {
  reportUrl: string | null;
  isRunning?: boolean;
  backToLabel?: string;
  backToUrl?: string;
  containerClassName?: string;
  iframeClassName?: string;
  loadingMessage?: string;
  hideEmptyMessage?: boolean;
  hideFullscreenButton?: boolean;
  hideReloadButton?: boolean;
}

export function ReportViewer({
  reportUrl,
  isRunning = false,
  backToLabel,
  backToUrl,
  containerClassName = "w-full h-full relative",
  iframeClassName = "w-full h-full",
  loadingMessage = "Loading report...",
  hideEmptyMessage = false,
  hideFullscreenButton = false,
  hideReloadButton = false,
}: ReportViewerProps) {
  const [isReportLoading, setIsReportLoading] = useState(!!reportUrl);
  const [reportError, setReportError] = useState<string | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [currentReportUrl, setCurrentReportUrl] = useState<string | null>(
    reportUrl
  );
  const [isValidationError, setIsValidationError] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [timeoutInfo, setTimeoutInfo] = useState<TimeoutErrorInfo | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null);

  // Update URL when prop changes
  useEffect(() => {
    if (reportUrl) {
      // Always ensure we have a timestamp parameter to prevent caching issues
      const finalUrl = reportUrl.includes("?")
        ? `${reportUrl}&t=${Date.now()}`
        : `${reportUrl}?t=${Date.now()}`;

      setCurrentReportUrl(finalUrl);
      setIsReportLoading(true);
      setIframeError(false);
      setReportError(null);
      setTimeoutInfo(null);

      // Check if the URL exists, but don't call the callback here
      // The onReportError callback will be called by the safety timeout or iframe error handlers
      fetch(finalUrl, { method: "HEAD" })
        .then((response) => {
          if (!response.ok) {
            if (response.status === 404) {
              setIsReportLoading(false);
              setIframeError(true);
              setReportError("The test report could not be found.");
              // Don't call onReportError here to prevent redirect loops
            }
          }
        })
        .catch((error) => {
          console.error("ReportViewer: Error pre-checking report URL:", error);
          setIsReportLoading(false);
          setIframeError(true);
          setReportError(
            "Failed to load test report. The report server might be unreachable."
          );
          // Don't call onReportError here to prevent redirect loops
        });
    } else {
      setCurrentReportUrl(null);
    }
  }, [reportUrl]);

  // Shared function to remove external buttons and settings icon from any iframe
  const removeExternalButtonFromIframe = (iframe: HTMLIFrameElement | null) => {
    if (iframe?.contentDocument) {
      try {
        // Simple CSS injection
        const style = iframe.contentDocument.createElement("style");
        style.textContent = `
          button.toolbar-button.link-external,
          button[title="Open snapshot in a new tab"],
          .codicon.codicon-link-external,
          /* Hide settings icon in trace viewer */
          button[title*="settings"],
          button[title*="Settings"],
          button[title*="gear"],
          button[title*="Gear"],
          .codicon.codicon-gear,
          .codicon.codicon-settings,
          /* Hide any button with gear/settings icon in the top right */
          .toolbar-button[title*="settings"],
          .toolbar-button[title*="Settings"],
          .toolbar-button[title*="gear"],
          .toolbar-button[title*="Gear"],
          /* More specific selectors for the settings icon */
          button[aria-label*="settings"],
          button[aria-label*="Settings"],
          button[aria-label*="gear"],
          button[aria-label*="Gear"],
          /* Hide by class names that might contain settings */
          .settings-button,
          .gear-button,
          .config-button,
          /* Additional Playwright-specific selectors */
          [data-testid*="settings"],
          [data-testid*="gear"],
          [class*="settings"],
          [class*="gear"],
          /* Hide any element with settings-related attributes */
          [title*="Configure"],
          [title*="configure"],
          [aria-label*="Configure"],
          [aria-label*="configure"] {
            display: none !important;
          }
        `;
        iframe.contentDocument.head.appendChild(style);
      } catch {
        // Ignore CORS errors
      }
    }
  };

  // Remove external buttons from main iframe
  useEffect(() => {
    if (currentReportUrl && !isReportLoading) {
      const removeExternalButton = () =>
        removeExternalButtonFromIframe(iframeRef.current);

      // Remove immediately and keep checking
      removeExternalButton();
      const interval = setInterval(removeExternalButton, 100);

      return () => clearInterval(interval);
    }
  }, [currentReportUrl, isReportLoading]);

  // Remove external buttons from fullscreen iframe
  useEffect(() => {
    if (showFullscreen && currentReportUrl) {
      const removeExternalButton = () =>
        removeExternalButtonFromIframe(fullscreenIframeRef.current);

      // Remove immediately and keep checking
      removeExternalButton();
      const interval = setInterval(removeExternalButton, 100);

      return () => clearInterval(interval);
    }
  }, [showFullscreen, currentReportUrl]);

  // Safety timeout to prevent loading state from getting stuck
  useEffect(() => {
    if (isReportLoading) {
      const safetyTimeout = setTimeout(() => {
        setIsReportLoading(false);

        // If the iframe failed silently, set error state
        if (currentReportUrl && !iframeError) {
          setIframeError(true);
          setReportError(
            "Report loading timed out. The report server might be unreachable."
          );
        }
      }, 10000); // 10 second timeout

      return () => {
        clearTimeout(safetyTimeout);
      };
    }
  }, [isReportLoading, currentReportUrl, iframeError]);

  // Add new effect to force retry if report is stuck loading
  useEffect(() => {
    if (isReportLoading && currentReportUrl) {
      // Set a shorter timeout for initial retry
      const retryTimeout = setTimeout(() => {
        // Add timestamp to force reload and bypass cache
        const refreshedUrl = `${
          currentReportUrl.split("?")[0]
        }?retry=true&t=${Date.now()}`;
        setCurrentReportUrl(refreshedUrl);
      }, 5000); // 5 second timeout before retry

      return () => clearTimeout(retryTimeout);
    }
  }, [isReportLoading, currentReportUrl]);

  // Static error page component
  const StaticErrorPage = ({
    title,
    message,
  }: {
    title: string;
    message: string;
  }) => (
    <div className="flex flex-col items-center justify-center w-full h-full p-8">
      <div className="flex flex-col items-center text-center max-w-md">
        <AlertCircle className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-3xl font-bold mb-2">{title}</h1>
        <p className="text-muted-foreground mb-6">{message}</p>
        <div className="flex gap-4">
          {backToUrl && (
            <Link
              href={backToUrl}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              {backToLabel || "Back"}
            </Link>
          )}
          {!hideReloadButton && (
            <Button
              onClick={() => {
                // Reload the entire page instead of just adding parameters to a broken URL
                window.location.reload();
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Reload Report
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // Loading state when the test is running - prioritize this check
  if (isRunning) {
    return (
      <div className={containerClassName}>
        <div className="w-full h-full flex items-center justify-center bg-card">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2Icon className="h-12 w-12 animate-spin" />
            <p className="text-muted-foreground text-lg">
              Please wait, running script...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state when no report is available - check this after isRunning
  if (!currentReportUrl && !isRunning) {
    return (
      <div className={containerClassName}>
        <div className="w-full h-full flex items-center justify-center bg-card">
          <div className="flex flex-col items-center gap-3 text-muted-foreground ">
            {!hideEmptyMessage && (
              <>
                <FileText className="h-10 w-10" />
                <p>Run the script to view the report</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Error state - only show if it's not a validation error
  if (iframeError && !isRunning && !isValidationError) {
    // Show timeout-specific error page if timeout detected
    if (timeoutInfo?.isTimeout) {
      return (
        <div className={containerClassName}>
          <TimeoutErrorPage
            timeoutInfo={timeoutInfo}
            backToLabel={backToLabel}
            backToUrl={backToUrl}
            containerClassName={containerClassName}
          />
        </div>
      );
    }

    // Show regular error page for non-timeout errors
    return (
      <div className={containerClassName}>
        <StaticErrorPage
          title="Report Not Found"
          message={
            reportError || "Test results not found or have been removed."
          }
        />
      </div>
    );
  }

  // Main report iframe with loading state
  return (
    <div className={containerClassName}>
      {isReportLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-card">
          <Loader2Icon className="h-12 w-12 animate-spin mb-2 text-muted-foreground" />
          <p className="text-lg text-muted-foreground">{loadingMessage}</p>
        </div>
      )}

      <div className="flex flex-col h-full w-full">
        {!isRunning && currentReportUrl && !isReportLoading && !iframeError && !hideFullscreenButton && (
          <div className="absolute top-2 right-2 z-10">
            <Button
              size="sm"
              className="cursor-pointer flex items-center gap-1 bg-secondary hover:bg-secondary/90"
              onClick={() => setShowFullscreen(true)}
            >
              <Maximize2 className="h-4 w-4 text-secondary-foreground" />
            </Button>
          </div>
        )}

        {!isRunning && currentReportUrl && (
          <iframe
            ref={iframeRef}
            key={currentReportUrl}
            src={currentReportUrl}
            className={`${iframeClassName} ${
              isReportLoading ? "opacity-0 pointer-events-none" : "opacity-100"
            } ${isValidationError ? "h-4/5 flex-grow" : "h-full"} bg-card`}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
            style={{
              visibility: isReportLoading ? "hidden" : "visible",
              transition: "opacity 0.3s ease-in-out",
            }}
            title="Report"
            onLoad={(e) => {
              const iframe = e.target as HTMLIFrameElement;
              try {
                // Verify we can access the contentWindow - if not, it's likely a CORS issue
                if (!iframe.contentWindow) {
                  console.error(
                    "ReportViewer: Cannot access iframe contentWindow - likely CORS issue"
                  );
                  setReportError(
                    "Cannot load report due to security restrictions. The report may be on a different domain."
                  );
                  setIframeError(true);
                  setIsValidationError(false);
                  setIsReportLoading(false);
                  return;
                }

                // Check for JSON error response by examining body content
                if (iframe.contentWindow?.document.body.textContent) {
                  const bodyText =
                    iframe.contentWindow.document.body.textContent;
                  const pageTitle = iframe.contentDocument?.title || "";

                  // Check for validation error page - allow these to display normally
                  if (
                    pageTitle.includes("Validation Error") ||
                    bodyText.includes("Test Validation Failed")
                  ) {
                    setIsValidationError(true);
                    setIframeError(false);
                    setIsReportLoading(false);
                    return;
                  }

                  // Check for other error status codes in the URL or HTML
                  if (
                    iframe.contentDocument?.title?.includes("Error") ||
                    iframe.contentDocument?.title?.includes("404") ||
                    iframe.contentDocument?.title?.includes("Not Found")
                  ) {
                    console.error(
                      "ReportViewer: Error page detected in iframe"
                    );
                    setReportError("The test report could not be found.");
                    setIframeError(true);
                    setIsValidationError(false);
                    setIsReportLoading(false);
                    return;
                  }

                  // Check for JSON error response
                  if (
                    bodyText.includes('"error"') &&
                    (bodyText.includes('"message"') ||
                      bodyText.includes('"details"'))
                  ) {
                    try {
                      const errorData = JSON.parse(bodyText);
                      const errorMessage =
                        errorData.message ||
                        errorData.details ||
                        errorData.error ||
                        "Unknown error";

                      // Check if this is a timeout error based on the API response
                      if (
                        errorData.timeoutInfo &&
                        errorData.timeoutInfo.isTimeout
                      ) {
                        setTimeoutInfo(errorData.timeoutInfo);
                      } else {
                        setReportError(errorMessage);
                      }

                      setIframeError(true);
                      setIsValidationError(false);
                      setIsReportLoading(false);
                      return;
                    } catch (e) {
                      // Not valid JSON, continue with normal display
                      console.error("ReportViewer: Error parsing JSON:", e);
                    }
                  }
                }

                // Always clear loading state, even if we think there might be an issue
                setIsReportLoading(false);
              } catch (loadError) {
                console.error(
                  "ReportViewer: Error in onLoad event:",
                  loadError
                );
                setIsReportLoading(false);
                // Set error state on any unexpected error
                setReportError(
                  "Failed to load test report. Please try refreshing the page."
                );
                setIframeError(true);
              }
            }}
            onError={(e) => {
              console.error("ReportViewer: iframe onError triggered", e);
              setIsReportLoading(false);
              setReportError(
                "Failed to load test report. The report server might be unreachable."
              );
              setIframeError(true);
            }}
          />
        )}

        {isValidationError && !isReportLoading && (
          <div className="px-6 py-4 border-t">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <h3 className="text-base font-medium">Action Required</h3>
            </div>
            <p className="text-sm">
              Please edit the script to fix the validation error shown above.
              You cannot run the script until this issue is resolved.
            </p>
          </div>
        )}
      </div>

      {/* Manual fullscreen implementation */}
      {showFullscreen && currentReportUrl && (
        <div className="fixed inset-0 z-50 bg-card/80 backdrop-blur-sm">
          <div className="fixed inset-8 bg-card rounded-lg shadow-lg flex flex-col overflow-hidden border">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlaywrightLogo width={36} height={36} />
                <h2 className="text-xl font-semibold">Report</h2>
              </div>
              <Button
                className="cursor-pointer bg-secondary hover:bg-secondary/90"
                size="sm"
                onClick={() => setShowFullscreen(false)}
              >
                <X className="h-4 w-4 text-secondary-foreground" />
              </Button>
            </div>
            <div className="flex-grow overflow-hidden">
              <iframe
                ref={fullscreenIframeRef}
                src={currentReportUrl}
                className="w-full h-full border-0"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
                title="Fullscreen Report"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
