"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  MonitorForm,
  type FormValues,
} from "@/components/monitors/monitor-form";
import { MonitorFormSkeleton } from "@/components/monitors/monitor-form-skeleton";
import { Monitor } from "@/components/monitors/schema";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { monitorTypes } from "@/components/monitors/data";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Can't use metadata in client components, remove this
// export const metadata: Metadata = {
//   title: "Edit Monitor | Supercheck",
//   description: "Edit your monitor configuration",
// };

export default function EditMonitorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [id, setId] = useState<string>("");
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get params on the client side
  useEffect(() => {
    params.then(({ id }) => setId(id));
  }, [params]);

  // Fetch monitor data with AbortController
  useEffect(() => {
    if (!id) return;

    const abortController = new AbortController();

    async function fetchMonitor() {
      try {
        setLoading(true);
        const response = await fetch(`/api/monitors/${id}`, {
          signal: abortController.signal
        });

        if (!response.ok) {
          if (response.status === 404) {
            setError("Monitor not found");
            toast.error("Monitor Not Found", {
              description: "The monitor you're looking for doesn't exist or has been deleted."
            });
            return;
          }
          setError(`Failed to fetch monitor: ${response.statusText}`);
          return;
        }

        const data = await response.json();
        setMonitor(data);
        setError(null);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // Request was cancelled, ignore
          return;
        }
        console.error("Error fetching monitor:", error);
        setError(
          error instanceof Error ? error.message : "Failed to fetch monitor"
        );
      } finally {
        setLoading(false);
      }
    }

    fetchMonitor();

    return () => {
      abortController.abort();
    };
  }, [id]);

  if (loading) {
    return (
      <div>
        <PageBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Monitors", href: "/monitors" },
            { label: "Loading...", isCurrentPage: true },
          ]}
        />
        <MonitorFormSkeleton />
      </div>
    );
  }

  if (error || !monitor) {
    return (
      <div>
        <PageBreadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Monitors", href: "/monitors" },
            { label: "Error", isCurrentPage: true },
          ]}
        />
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-semibold text-destructive">Failed to Load Monitor</h2>
            <p className="text-muted-foreground">
              {error || "Monitor not found"}
            </p>
          </div>
          <div className="flex gap-4">
            <Button
              onClick={() => window.location.reload()}
              variant="default"
            >
              Retry
            </Button>
            <Button
              onClick={() => router.push("/monitors")}
              variant="secondary"
            >
              Back to Monitors
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Map Monitor.type to FormValues.type first
  let formType: FormValues["type"];
  const currentType = monitor.type;

  // Check if monitor.type is directly one of the FormValues types
  const formValueTypes = [
    "http_request",
    "website",
    "ping_host",
    "port_check",
    "synthetic_test",
  ] as const;

  if ((formValueTypes as readonly string[]).includes(currentType)) {
    formType = currentType as FormValues["type"];
  } else {
    // Handle cases where Monitor.type needs mapping (e.g., old "get"/"post" to "http_request")
    // Or if it's an unmapped but valid Monitor.type
    switch (currentType) {
      case "get" as string: // Legacy type mapping
      case "post" as string: // Legacy type mapping
        formType = "http_request";
        console.warn(
          `Monitor type '${currentType}' mapped to form type 'http_request'.`
        );
        break;
      // Add other specific mappings here if necessary
      default:
        // Fallback for valid Monitor types not directly usable or mapped
        console.warn(
          `Unmapped monitor type '${currentType}' for direct FormValues type. Defaulting to http_request.`
        );
        formType = "http_request";
        break;
    }
  }

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Monitors", href: "/monitors" },
    {
      label:
        monitor.name && monitor.name.length > 20
          ? `${monitor.name?.substring(0, 20)}...`
          : monitor.name || id,
      href: `/monitors/${id}`,
    },
    { label: "Edit", isCurrentPage: true },
  ];

  // Get monitor type info for the title
  const monitorTypeInfo = monitorTypes.find((t) => t.value === formType);

  // Convert monitor.frequencyMinutes to FormValues.interval (seconds as string)
  const validFormIntervals = [
    "60",
    "300",
    "600",
    "900",
    "1800",
    "3600",
    "10800",
    "43200",
    "86400",
  ];
  let formInterval: FormValues["interval"] = "60"; // Default interval

  // Convert frequencyMinutes to seconds
  const intervalInSeconds = (monitor.frequencyMinutes || 1) * 60;
  if (validFormIntervals.includes(intervalInSeconds.toString())) {
    formInterval = intervalInSeconds.toString() as FormValues["interval"];
  } else {
    console.warn(
      `Monitor frequency ${monitor.frequencyMinutes} minutes (${intervalInSeconds} seconds) not in form options. Defaulting to 60s.`
    );
  }

  // Prepare data for the form, ensuring all required fields for FormValues are present
  const formData: FormValues = {
    name: monitor.name,
    target: monitor.target || monitor.url || "",
    type: formType,
    interval: formInterval,
    httpConfig_authType:
      (monitor.config?.auth?.type as "none" | "basic" | "bearer") || "none",

    // HTTP-specific fields
    httpConfig_method:
      formType === "http_request"
        ? (monitor.config?.method as
          | "GET"
          | "POST"
          | "PUT"
          | "DELETE"
          | "PATCH"
          | "HEAD"
          | "OPTIONS") || "GET"
        : "GET",
    httpConfig_expectedStatusCodes:
      formType === "http_request" || formType === "website"
        ? monitor.config?.expectedStatusCodes || "200-299"
        : "200-299",
    httpConfig_headers:
      (formType === "http_request" || formType === "website") && monitor.config?.headers
        ? JSON.stringify(monitor.config.headers, null, 2)
        : "",
    httpConfig_body:
      formType === "http_request" ? monitor.config?.body || "" : "",
    httpConfig_keywordInBody:
      formType === "http_request" || formType === "website"
        ? monitor.config?.keywordInBody || ""
        : "",
    httpConfig_keywordShouldBePresent:
      formType === "http_request" || formType === "website"
        ? monitor.config?.keywordInBodyShouldBePresent !== false
        : true,

    // Auth fields
    httpConfig_authUsername: monitor.config?.auth?.username || "",
    httpConfig_authPassword: monitor.config?.auth?.password || "",
    httpConfig_authToken: monitor.config?.auth?.token || "",

    // Port Check specific
    portConfig_port:
      formType === "port_check" ? monitor.config?.port || 80 : 80,
    portConfig_protocol:
      formType === "port_check"
        ? (monitor.config?.protocol as "tcp" | "udp") || "tcp"
        : "tcp",
    portConfig_expectClosed:
      formType === "port_check" ? monitor.config?.expectClosed || false : false,

    // Website SSL-specific
    websiteConfig_enableSslCheck:
      formType === "website" ? monitor.config?.enableSslCheck || false : false,
    websiteConfig_sslDaysUntilExpirationWarning:
      formType === "website"
        ? monitor.config?.sslDaysUntilExpirationWarning || 30
        : 30,

    // Synthetic test specific
    syntheticConfig_testId:
      formType === "synthetic_test" ? monitor.config?.testId || "" : "",
  };

  return (
    <div>
      <PageBreadcrumbs items={breadcrumbs} />
      <MonitorForm
        initialData={formData}
        editMode={true}
        id={id}
        monitorType={formType}
        title={`Edit ${monitorTypeInfo?.label || "Monitor"}`}
        description={`Update ${monitor.name} configuration`}
        alertConfig={monitor.alertConfig}
        initialConfig={monitor.config}
      />
    </div>
  );
}
