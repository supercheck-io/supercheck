"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm, Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import TestSelector from "@/components/shared/test-selector";
import { Test } from "@/components/jobs/schema";
import { monitorTypes } from "./data";
import {
  Loader2,
  SaveIcon,
  ChevronDown,
  ChevronRight,
  Shield,
  BellIcon,
  MapPin,
  Info,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { MonitorTypesPopover } from "./monitor-types-popover";
import { LocationConfigSection } from "./location-config-section";
import { DEFAULT_LOCATION_CONFIG } from "@/lib/location-service";
import type { LocationConfig } from "@/lib/location-service";
import { sanitizeMonitorFormData } from "@/lib/input-sanitizer";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { canCreateMonitors } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import { useProjectContext } from "@/hooks/use-project-context";
import { useAppConfig } from "@/hooks/use-app-config";
import { useQueryClient } from "@tanstack/react-query";
import { MONITORS_QUERY_KEY } from "@/hooks/use-monitors";
import { useTest } from "@/hooks/use-tests";

// Define presets for Expected Status Codes
const statusCodePresets = [
  { label: "Any 2xx (Success)", value: "200-299" },
  { label: "Any 3xx (Redirection)", value: "300-399" },
  { label: "Any 4xx (Client Error)", value: "400-499" },
  { label: "Any 5xx (Server Error)", value: "500-599" },
  { label: "Specific Code", value: "custom" }, // User can input custom code
];

// Interval options for non-synthetic monitors (can start from 1 minute)
const standardCheckIntervalOptions = [
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "900", label: "15 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "10800", label: "3 hours" },
  { value: "43200", label: "12 hours" },
  { value: "86400", label: "24 hours" },
];

// Interval options for synthetic monitors (minimum 5 minutes)
const syntheticCheckIntervalOptions = [
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "900", label: "15 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "10800", label: "3 hours" },
  { value: "43200", label: "12 hours" },
  { value: "86400", label: "24 hours" },
];

// Create schema for the form with conditional validation
const formSchema = z
  .object({
    name: z
      .string()
      .min(10, "Name must be at least 10 characters")
      .max(100, "Name must be 100 characters or less"),
    target: z.string().optional(),
    type: z.enum(
      ["http_request", "website", "ping_host", "port_check", "synthetic_test"],
      {
        required_error: "Please select a check type",
      }
    ),
    interval: z.string().default("1800"),
    // Synthetic test specific
    syntheticConfig_testId: z.string().optional(),
    // Optional fields that may be required based on type
    // HTTP Request specific
    httpConfig_method: z
      .enum(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
      .default("GET"),
    httpConfig_headers: z
      .string()
      .optional()
      .refine((val) => {
        if (!val || val.trim() === "") return true;
        try {
          const parsed = JSON.parse(val);
          return typeof parsed === "object" && parsed !== null;
        } catch {
          return false;
        }
      }, 'Headers must be valid JSON format, e.g., {"Content-Type": "application/json"}'),
    httpConfig_body: z.string().optional(),
    httpConfig_expectedStatusCodes: z
      .string()
      .min(1, "Expected status codes are required")
      .default("200-299"),
    httpConfig_keywordInBody: z.string().optional(),
    httpConfig_keywordShouldBePresent: z.boolean().default(true),
    // Auth fields for HTTP Request
    httpConfig_authType: z.enum(["none", "basic", "bearer"]).default("none"),
    httpConfig_authUsername: z.string().optional(),
    httpConfig_authPassword: z.string().optional(),
    httpConfig_authToken: z.string().optional(),
    // Port Check specific
    portConfig_port: z.coerce
      .number()
      .int()
      .min(1, "Port must be at least 1")
      .max(65535, "Port must be 65535 or less")
      .optional(),
    portConfig_protocol: z.enum(["tcp", "udp"]).default("tcp"),
    // Website SSL checking
    websiteConfig_enableSslCheck: z.boolean().default(false),
    websiteConfig_sslDaysUntilExpirationWarning: z.coerce
      .number()
      .int()
      .min(1, "SSL warning days must be at least 1")
      .max(365, "SSL warning days must be 365 or less")
      .default(30), // 1 day to 1 year
  })
  .superRefine((data, ctx) => {
    // Interval validation for synthetic monitors
    if (data.type === "synthetic_test") {
      const intervalSeconds = parseInt(data.interval, 10);
      if (intervalSeconds < 300) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Synthetic monitors require a minimum check interval of 5 minutes",
          path: ["interval"],
        });
      }
    }

    // Target validation varies by monitor type
    if (data.type === "synthetic_test") {
      // For synthetic monitors, testId is required instead of target
      if (
        !data.syntheticConfig_testId ||
        data.syntheticConfig_testId.trim() === ""
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please select a test to monitor",
          path: ["syntheticConfig_testId"],
        });
      }
    } else {
      // Target is required for all other monitor types
      if (!data.target || data.target.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Target is required for this monitor type",
          path: ["target"],
        });
      }

      // Validate target format based on type
      if (data.target && data.target.trim()) {
        const target = data.target.trim();

        if (data.type === "http_request" || data.type === "website") {
          // URL validation
          try {
            new URL(target);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Target must be a valid URL (e.g., https://example.com)",
              path: ["target"],
            });
          }
        }

        if (data.type === "ping_host" || data.type === "port_check") {
          // Hostname or IP validation
          const hostnameRegex =
            /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
          const ipRegex =
            /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

          if (!hostnameRegex.test(target) && !ipRegex.test(target)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Target must be a valid hostname or IP address",
              path: ["target"],
            });
          }
        }
      }
    }

    // Port is required for port_check
    if (data.type === "port_check") {
      if (!data.portConfig_port) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Port is required for port check monitors",
          path: ["portConfig_port"],
        });
      }

      if (!data.portConfig_protocol) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Protocol is required for port check monitors",
          path: ["portConfig_protocol"],
        });
      }
    }

    // Authentication validation
    if (data.httpConfig_authType === "basic") {
      if (
        !data.httpConfig_authUsername ||
        data.httpConfig_authUsername.trim() === ""
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Username is required for Basic Authentication",
          path: ["httpConfig_authUsername"],
        });
      }
      if (
        !data.httpConfig_authPassword ||
        data.httpConfig_authPassword.trim() === ""
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password is required for Basic Authentication",
          path: ["httpConfig_authPassword"],
        });
      }
    }

    if (data.httpConfig_authType === "bearer") {
      if (
        !data.httpConfig_authToken ||
        data.httpConfig_authToken.trim() === ""
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Token is required for Bearer Authentication",
          path: ["httpConfig_authToken"],
        });
      }
    }

    // SSL warning days validation
    if (data.websiteConfig_enableSslCheck && data.type === "website") {
      if (
        !data.websiteConfig_sslDaysUntilExpirationWarning ||
        data.websiteConfig_sslDaysUntilExpirationWarning < 1
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "SSL warning days must be at least 1 when SSL check is enabled",
          path: ["websiteConfig_sslDaysUntilExpirationWarning"],
        });
      }
    }
  });

// Define the form values type
export type FormValues = z.infer<typeof formSchema>;

// Default values for creating a new monitor
const creationDefaultValues: FormValues = {
  name: "",
  target: "",
  type: "http_request",
  interval: "1800", // Default to 30 minutes
  httpConfig_authType: "none",
  httpConfig_method: "GET",
  httpConfig_headers: "",
  httpConfig_body: "",
  httpConfig_expectedStatusCodes: "200-299",
  httpConfig_keywordInBody: "",
  httpConfig_keywordShouldBePresent: false,
  httpConfig_authUsername: "",
  httpConfig_authPassword: "",
  httpConfig_authToken: "",
  portConfig_port: 80, // Default port instead of undefined
  portConfig_protocol: "tcp", // Default protocol instead of undefined
  websiteConfig_enableSslCheck: false, // Default to false instead of undefined
  websiteConfig_sslDaysUntilExpirationWarning: 30, // Default to 30 days instead of undefined
  syntheticConfig_testId: "", // Default for synthetic monitors
};

const mapApiTestToTest = (testData: Record<string, unknown>): Test => {
  const validTypes: Test["type"][] = [
    "browser",
    "api",
    "custom",
    "database",
    "performance",
  ];
  const validTestType: Test["type"] = validTypes.includes(
    testData.type as Test["type"]
  )
    ? (testData.type as Test["type"])
    : "browser";

  return {
    id: testData.id as string,
    name: (testData.title || testData.name || testData.id) as string,
    description: (testData.description as string) || null,
    type: validTestType,
    status: "running",
    lastRunAt: testData.updatedAt as string | undefined,
    duration: null,
    tags: (Array.isArray(testData.tags) ? testData.tags : []) as Array<{
      id: string;
      name: string;
      color: string | null;
    }>,
  };
};

// Add AlertConfiguration type
interface AlertConfiguration {
  enabled: boolean;
  notificationProviders: string[];
  alertOnFailure: boolean;
  alertOnRecovery?: boolean;
  alertOnSslExpiration?: boolean;
  alertOnSuccess?: boolean;
  alertOnTimeout?: boolean;
  failureThreshold: number;
  recoveryThreshold: number;
  customMessage?: string;
}

interface MonitorFormProps {
  initialData?: FormValues;
  editMode?: boolean;
  id?: string;
  monitorType?: FormValues["type"];
  title?: string;
  description?: string;
  hideAlerts?: boolean;
  onSave?: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
  alertConfig?: AlertConfiguration | null; // Use proper type
  initialConfig?: Record<string, unknown> | null; // Monitor config including locationConfig
  setMonitorData?: (data: Record<string, unknown>) => void; // For wizard state management
}

export function MonitorForm({
  initialData,
  editMode = false,
  id,
  monitorType,
  title,
  description,
  hideAlerts = false,
  onSave,
  onCancel,
  alertConfig: initialAlertConfig,
  initialConfig,
  setMonitorData,
}: MonitorFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { maxMonitorNotificationChannels } = useAppConfig();

  // Get user permissions
  const { currentProject } = useProjectContext();
  const normalizedRole = normalizeRole(currentProject?.userRole);
  const canCreate = canCreateMonitors(normalizedRole);
  const [isAuthSectionOpen, setIsAuthSectionOpen] = useState(false);
  const [isKeywordSectionOpen, setIsKeywordSectionOpen] = useState(false);
  const [isCustomStatusCode, setIsCustomStatusCode] = useState(false);
  // Store initial alert config for change detection
  const initialAlertConfigValue = useMemo(() => {
    return initialAlertConfig || {
      enabled: false,
      notificationProviders: [] as string[],
      alertOnFailure: true,
      alertOnRecovery: true,
      alertOnSslExpiration: false,
      failureThreshold: 1,
      recoveryThreshold: 1,
      customMessage: "" as string,
    };
  }, [initialAlertConfig]);

  const [alertConfig, setAlertConfig] = useState(initialAlertConfigValue);

  const [showAlerts, setShowAlerts] = useState(false);
  const [showLocationSettings, setShowLocationSettings] = useState(false);

  // Store initial configs for change detection
  const initialLocationConfig =
    (initialConfig?.locationConfig as LocationConfig) ||
    DEFAULT_LOCATION_CONFIG;
  const [locationConfig, setLocationConfig] = useState<LocationConfig>(
    initialLocationConfig
  );
  const [selectedTests, setSelectedTests] = useState<Test[]>([]);

  // Track previous selected test ID to prevent unnecessary updates
  const prevSelectedTestIdRef = React.useRef<string | null>(null);

  // Get current monitor type from URL params if not provided as prop
  const urlType = searchParams.get("type") as FormValues["type"];
  const fromTestId = searchParams.get("fromTest");
  const currentMonitorType = monitorType || urlType || "http_request";

  // (moved below after form initialization)

  // Handle alert config changes - but never auto-show alerts in edit mode
  useEffect(() => {
    // Only auto-show alerts for new monitor creation, never for edit mode
    if (alertConfig && !editMode) {
      setShowAlerts(alertConfig.enabled);
    }
  }, [alertConfig, editMode]);

  // Create default values based on monitor type if provided
  const getDefaultValues = useCallback((): FormValues => {
    // If we have initialData (edit mode), use it
    if (initialData) {
      return initialData;
    }

    // Otherwise, create defaults based on current monitor type
    const typeToUse = currentMonitorType;
    if (typeToUse) {
      return {
        name: "",
        target: "",
        type: typeToUse,
        interval: "1800",
        httpConfig_authType: "none",
        httpConfig_method: "GET",
        httpConfig_headers: "",
        httpConfig_body: "",
        httpConfig_expectedStatusCodes: "200-299",
        httpConfig_keywordInBody: "",
        httpConfig_keywordShouldBePresent: false,
        httpConfig_authUsername: "",
        httpConfig_authPassword: "",
        httpConfig_authToken: "",
        portConfig_port: typeToUse === "port_check" ? 80 : 80, // Always provide default
        portConfig_protocol: typeToUse === "port_check" ? "tcp" : "tcp", // Always provide default
        websiteConfig_enableSslCheck: typeToUse === "website" ? false : false, // Always provide default
        websiteConfig_sslDaysUntilExpirationWarning:
          typeToUse === "website" ? 30 : 30, // Always provide default
        syntheticConfig_testId: fromTestId || "", // Pre-fill if coming from test page
      };
    }
    return creationDefaultValues;
  }, [currentMonitorType, initialData, fromTestId]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    mode: "onSubmit", // Only validate on submit, not on every change
    defaultValues: {
      ...getDefaultValues(),
      type: currentMonitorType, // Ensure type is set correctly from URL
    },
  });

  // Memoize the config change detection - must be after form initialization
  const hasAnyConfigChanged = useCallback((): boolean => {
    const formDirty = form.formState.isDirty;
    const locationChanged =
      JSON.stringify(locationConfig) !== JSON.stringify(initialLocationConfig);
    const alertChanged =
      JSON.stringify(alertConfig) !== JSON.stringify(initialAlertConfigValue);
    return formDirty || locationChanged || alertChanged;
  }, [
    form.formState.isDirty,
    locationConfig,
    initialLocationConfig,
    alertConfig,
    initialAlertConfigValue,
  ]);

  const type = form.watch("type");
  const httpMethod = form.watch("httpConfig_method");
  const authType = form.watch("httpConfig_authType");
  const expectedStatusCodes = form.watch("httpConfig_expectedStatusCodes");
  const syntheticTestId = form.watch("syntheticConfig_testId");

  // Auto-adjust interval when switching to synthetic monitor
  useEffect(() => {
    if (type === "synthetic_test") {
      const currentInterval = parseInt(form.getValues("interval"), 10);
      if (currentInterval < 300) {
        // If current interval is less than 5 minutes, set to 5 minutes
        form.setValue("interval", "300");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Keep custom-status-code UI state in sync with the field value
  useEffect(() => {
    const presetValues = ["200-299", "300-399", "400-499", "500-599"];
    const currentValue = expectedStatusCodes || "200-299";
    setIsCustomStatusCode(
      !presetValues.includes(currentValue) && currentValue !== ""
    );
  }, [expectedStatusCodes]);

  // Reset form when URL params change (for monitor type)
  useEffect(() => {
    // Always reset form when URL type changes, unless we're in edit mode
    if (!editMode && urlType && urlType !== type) {
      // Create fresh default values for the new monitor type
      const newDefaults: FormValues = {
        ...creationDefaultValues,
        type: urlType,
      };

      // Reset form completely
      form.reset(newDefaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlType, type, editMode, initialData]);

  // Handle initial form setup when component first mounts
  useEffect(() => {
    if (!editMode && !initialData && urlType) {
      const initialDefaults: FormValues = {
        ...creationDefaultValues,
        type: urlType,
      };
      form.reset(initialDefaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, initialData, urlType]); // Run when these values change

  // Initialize form with initialData in edit mode
  useEffect(() => {
    if (editMode && initialData) {
      form.reset(initialData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, initialData]);

  // Determine which test ID to fetch for synthetic monitors
  // Priority: initialData (edit mode) > syntheticTestId (form field) > fromTestId (URL param)
  const syntheticTestIdToFetch = useMemo(() => {
    if (type !== "synthetic_test") return null;

    // In edit mode, use the initial test ID
    if (editMode && initialData?.syntheticConfig_testId) {
      return initialData.syntheticConfig_testId;
    }

    // For new monitors or changed test ID
    const trimmedTestId = syntheticTestId?.trim();
    if (trimmedTestId) {
      return trimmedTestId;
    }

    return null;
  }, [type, editMode, initialData?.syntheticConfig_testId, syntheticTestId]);

  // Use React Query hook for test data - single source of truth, no duplicate calls
  const { data: fetchedTestData } = useTest(syntheticTestIdToFetch);

  // Sync selectedTests when test data is fetched via React Query
  useEffect(() => {
    // Clear selections when switching away from synthetic monitors
    if (type !== "synthetic_test") {
      if (prevSelectedTestIdRef.current !== null) {
        prevSelectedTestIdRef.current = null;
        setSelectedTests([]);
      }
      return;
    }

    // If we have fetched test data, update selectedTests
    // Use ref to track previous selection and avoid unnecessary re-renders
    if (fetchedTestData && syntheticTestIdToFetch) {
      if (prevSelectedTestIdRef.current !== syntheticTestIdToFetch) {
        prevSelectedTestIdRef.current = syntheticTestIdToFetch;
        // Type assertion is safe here as fetchedTestData matches the expected shape
        const testRecord: Record<string, unknown> = {
          id: fetchedTestData.id,
          title: fetchedTestData.title,
          name: fetchedTestData.name,
          description: fetchedTestData.description,
          type: fetchedTestData.type,
          updatedAt: fetchedTestData.updatedAt,
          tags: fetchedTestData.tags,
        };
        setSelectedTests([mapApiTestToTest(testRecord)]);
      }
    }
  }, [type, fetchedTestData, syntheticTestIdToFetch]);

  const targetPlaceholders: Record<FormValues["type"], string> = {
    http_request: "e.g., https://example.com or https://api.example.com/health",
    website: "e.g., https://example.com or https://mywebsite.com",
    ping_host: "e.g., example.com or 8.8.8.8 (IP address or hostname)",
    port_check: "e.g., example.com or 192.168.1.1 (hostname or IP address)",
    synthetic_test: "Select a test to monitor",
  };

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);

    // Sanitize all input data before processing
    const sanitizedData = sanitizeMonitorFormData(data);

    // Convert form data to API format
    let config: Record<string, unknown> = {};
    const apiData: Record<string, unknown> = {
      name: sanitizedData.name,
      target: sanitizedData.target || "",
      type: sanitizedData.type,
      // Convert interval from seconds to minutes
      frequencyMinutes: Math.round(
        parseInt(sanitizedData.interval || "1800", 10) / 60
      ),
      config,
    };

    // Build config based on monitor type
    if (sanitizedData.type === "http_request") {
      config = {
        method: sanitizedData.httpConfig_method || "GET",
        expectedStatusCodes:
          sanitizedData.httpConfig_expectedStatusCodes || "200-299",
        timeoutSeconds: 30, // Default timeout
      };

      // Add headers if provided
      if (
        sanitizedData.httpConfig_headers &&
        sanitizedData.httpConfig_headers.trim()
      ) {
        try {
          const parsedHeaders = JSON.parse(sanitizedData.httpConfig_headers);
          if (typeof parsedHeaders === "object" && parsedHeaders !== null) {
            config.headers = parsedHeaders;
          }
        } catch (e) {
          console.warn("Failed to parse headers as JSON:", e);
          throw new Error(
            'Headers must be valid JSON format, e.g., {"Content-Type": "application/json"}'
          );
        }
      }

      // Add body if provided
      if (
        sanitizedData.httpConfig_body &&
        sanitizedData.httpConfig_body.trim()
      ) {
        config.body = sanitizedData.httpConfig_body;
      }

      // Add auth if configured
      if (
        sanitizedData.httpConfig_authType &&
        sanitizedData.httpConfig_authType !== "none"
      ) {
        if (sanitizedData.httpConfig_authType === "basic") {
          if (
            !sanitizedData.httpConfig_authUsername ||
            !sanitizedData.httpConfig_authPassword
          ) {
            throw new Error(
              "Username and password are required for Basic Auth"
            );
          }
          config.auth = {
            type: "basic",
            username: sanitizedData.httpConfig_authUsername,
            password: sanitizedData.httpConfig_authPassword,
          };
        } else if (sanitizedData.httpConfig_authType === "bearer") {
          if (!sanitizedData.httpConfig_authToken) {
            throw new Error("Token is required for Bearer Auth");
          }
          config.auth = {
            type: "bearer",
            token: sanitizedData.httpConfig_authToken,
          };
        }
      }

      // Add keyword checking if configured, or explicitly remove if empty
      if (
        sanitizedData.httpConfig_keywordInBody &&
        sanitizedData.httpConfig_keywordInBody.trim()
      ) {
        config.keywordInBody = sanitizedData.httpConfig_keywordInBody;
        config.keywordInBodyShouldBePresent =
          sanitizedData.httpConfig_keywordShouldBePresent !== false;
      } else {
        // Explicitly remove keyword validation if field is empty
        delete config.keywordInBody;
        delete config.keywordInBodyShouldBePresent;
      }
    } else if (sanitizedData.type === "website") {
      // Website monitoring is essentially HTTP GET with simplified config
      config = {
        method: "GET",
        expectedStatusCodes:
          sanitizedData.httpConfig_expectedStatusCodes || "200-299",
        timeoutSeconds: 30, // Default timeout
      };

      // Add auth if configured
      if (
        sanitizedData.httpConfig_authType &&
        sanitizedData.httpConfig_authType !== "none"
      ) {
        if (data.httpConfig_authType === "basic") {
          if (
            !sanitizedData.httpConfig_authUsername ||
            !sanitizedData.httpConfig_authPassword
          ) {
            throw new Error(
              "Username and password are required for Basic Auth"
            );
          }
          config.auth = {
            type: "basic",
            username: sanitizedData.httpConfig_authUsername,
            password: sanitizedData.httpConfig_authPassword,
          };
        } else if (sanitizedData.httpConfig_authType === "bearer") {
          if (!sanitizedData.httpConfig_authToken) {
            throw new Error("Token is required for Bearer Auth");
          }
          config.auth = {
            type: "bearer",
            token: sanitizedData.httpConfig_authToken,
          };
        }
      }

      // Add keyword checking if configured
      if (
        sanitizedData.httpConfig_keywordInBody &&
        sanitizedData.httpConfig_keywordInBody.trim()
      ) {
        config.keywordInBody = sanitizedData.httpConfig_keywordInBody;
        config.keywordInBodyShouldBePresent =
          sanitizedData.httpConfig_keywordShouldBePresent !== false;
      } else {
        // Explicitly remove keyword validation if field is empty
        delete config.keywordInBody;
        delete config.keywordInBodyShouldBePresent;
      }

      // Add SSL checking configuration - handle boolean properly
      const sslCheckEnabled = Boolean(
        sanitizedData.websiteConfig_enableSslCheck
      );
      config.enableSslCheck = sslCheckEnabled;

      if (sslCheckEnabled) {
        config.sslDaysUntilExpirationWarning =
          sanitizedData.websiteConfig_sslDaysUntilExpirationWarning || 30;
      } else {
        // When SSL is disabled, still set the field explicitly but remove the warning days to clean up config
        delete config.sslDaysUntilExpirationWarning;
      }
    } else if (sanitizedData.type === "port_check") {
      config = {
        port: sanitizedData.portConfig_port,
        protocol: sanitizedData.portConfig_protocol || "tcp",
        timeoutSeconds: 10, // Default timeout for port checks
      };
    } else if (data.type === "ping_host") {
      config = {
        timeoutSeconds: 5, // Default timeout for ping
      };
    } else if (sanitizedData.type === "synthetic_test") {
      // Synthetic monitor configuration
      if (!sanitizedData.syntheticConfig_testId) {
        throw new Error("Please select a test to monitor");
      }

      // Get the selected test details from selectedTests array
      const selectedTest = selectedTests.find(
        (test) => test.id === sanitizedData.syntheticConfig_testId
      );

      apiData.target = sanitizedData.syntheticConfig_testId; // Use testId as target
      config = {
        testId: sanitizedData.syntheticConfig_testId,
        testTitle: selectedTest?.name || sanitizedData.syntheticConfig_testId,
        playwrightOptions: {
          headless: true,
          timeout: 300000, // 5 minutes default
          retries: 0,
        },
      };
    }

    // Add location config to all monitor types
    config.locationConfig = locationConfig;
    apiData.config = config;

    try {
      // If onSave callback is provided (wizard mode), pass the form data and API data
      if (onSave) {
        // Pass both the form values and the API data
        onSave({ formData: data, apiData }); // Pass both for wizard state management
        setIsSubmitting(false);
        return;
      }

      // For edit mode, always go directly to save - never show alerts from form submission
      // Alerts can only be accessed via the "Configure Alerts" button in edit mode
      if (editMode) {
        await handleDirectSave(apiData, true); // Include existing alert settings to preserve them
        return;
      }

      // For creation mode, check if we should show alerts or save directly
      if (!editMode && !hideAlerts && searchParams.get("tab") === "alerts") {
        if (setMonitorData) {
          setMonitorData({ formData: data, apiData });
        }
        setShowAlerts(true);
        setIsSubmitting(false);
        return;
      }

      // Direct save mode (creation without alerts)
      await handleDirectSave(apiData);
    } catch (error) {
      console.error("Error processing monitor:", error);
      toast.error(
        editMode ? "Failed to update monitor" : "Failed to create monitor",
        {
          description:
            error instanceof Error
              ? error.message
              : "An unknown error occurred",
        }
      );
      setIsSubmitting(false);
    }
  }

  async function handleDirectSave(
    apiData: Record<string, unknown>,
    includeAlerts = false
  ) {
    setIsSubmitting(true);

    try {
      const saveData = includeAlerts ? { ...apiData, alertConfig } : apiData;
      const endpoint = editMode ? `/api/monitors/${id}` : "/api/monitors";
      const method = editMode ? "PUT" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(saveData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save monitor");
      }

      const result = await response.json();

      toast.success(editMode ? "Monitor updated" : "Monitor created", {
        description: editMode
          ? `Monitor "${apiData.name}" has been updated.`
          : `Monitor "${apiData.name}" has been created.`,
      });

      // Invalidate Monitors cache to ensure fresh data on monitors page
      queryClient.invalidateQueries({ queryKey: MONITORS_QUERY_KEY, refetchType: 'all' });

      if (editMode) {
        router.push(`/monitors/${id}`);
      } else {
        router.push(`/monitors/${result.id}`);
      }
    } catch (error) {
      console.error("Error saving monitor:", error);
      toast.error(
        editMode ? "Failed to update monitor" : "Failed to create monitor",
        {
          description:
            error instanceof Error
              ? error.message
              : "An unknown error occurred",
        }
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFinalSubmit() {
    // Validate alert configuration before proceeding
    if (alertConfig.enabled) {
      // Check if at least one notification provider is selected
      if (
        !alertConfig.notificationProviders ||
        alertConfig.notificationProviders.length === 0
      ) {
        toast.error("Validation Error", {
          description:
            "At least one notification channel must be selected when alerts are enabled",
        });
        return;
      }

      // Check notification channel limit
      if (
        alertConfig.notificationProviders.length >
        maxMonitorNotificationChannels
      ) {
        toast.error("Validation Error", {
          description: `You can only select up to ${maxMonitorNotificationChannels} notification channels`,
        });
        return;
      }

      // Check if at least one alert type is selected
      const alertTypesSelected = [
        alertConfig.alertOnFailure,
        alertConfig.alertOnRecovery,
        alertConfig.alertOnSslExpiration,
      ].some(Boolean);

      if (!alertTypesSelected) {
        toast.error("Validation Error", {
          description:
            "At least one alert type must be selected when alerts are enabled",
        });
        return;
      }
    }

    // Save alerts and/or location config
    // IMPORTANT: Merge with existing config to preserve fields like testId
    if (editMode && id) {
      const updateData = {
        alertConfig: alertConfig,
        config: {
          ...(initialConfig || {}), // Preserve existing config fields
          locationConfig: locationConfig, // Override only locationConfig
        },
      };
      await handleDirectSave(updateData, true);
    }
  }

  if (showLocationSettings) {
    return (
      <div className="space-y-4 p-4 min-h-[calc(100vh-8rem)]">
        <Card>
          <CardHeader>
            <CardTitle>
              Location Settings{" "}
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                Optional
              </span>
            </CardTitle>
            <CardDescription>
              Configure multi-location monitoring for better reliability and
              global coverage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <LocationConfigSection
              value={locationConfig}
              onChange={setLocationConfig}
              disabled={isSubmitting}
            />
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowLocationSettings(false)}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button
                onClick={handleFinalSubmit}
                disabled={isSubmitting || !hasAnyConfigChanged()}
                className="flex items-center"
              >
                <SaveIcon className="mr-2 h-4 w-4" />
                {isSubmitting ? "Updating..." : "Update Monitor"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showAlerts) {
    return (
      <div className="space-y-4 p-4 min-h-[calc(100vh-8rem)]">
        <Card>
          <CardHeader>
            <CardTitle>
              Alert Settings{" "}
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                Optional
              </span>
            </CardTitle>
            <CardDescription>
              Configure alert notifications for this monitor
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AlertSettings
              value={alertConfig}
              onChange={(config) =>
                setAlertConfig({
                  enabled: config.enabled,
                  notificationProviders: config.notificationProviders,
                  alertOnFailure: config.alertOnFailure,
                  alertOnRecovery: config.alertOnRecovery || false,
                  alertOnSslExpiration: config.alertOnSslExpiration || false,
                  failureThreshold: config.failureThreshold,
                  recoveryThreshold: config.recoveryThreshold,
                  customMessage: config.customMessage || "",
                })
              }
              context="monitor"
              monitorType={type}
              sslCheckEnabled={
                type === "website" && form.watch("websiteConfig_enableSslCheck")
              }
            />
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAlerts(false)}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button
                onClick={handleFinalSubmit}
                disabled={isSubmitting || !hasAnyConfigChanged()}
                className="flex items-center"
              >
                <SaveIcon className="mr-2 h-4 w-4" />
                {isSubmitting ? "Updating..." : "Update Monitor"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 min-h-[calc(100vh-8rem)]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <div className="flex items-center gap-2">
              {monitorTypes.map(
                (type) =>
                  monitorType === type.value && (
                    <type.icon
                      className={`h-6 w-6 ${type.color} mt-0.5 flex-shrink-0`}
                      key={type.value}
                    />
                  )
              )}
              <CardTitle className="text-2xl font-semibold">
                {title || (editMode ? "Edit Monitor" : "Create Monitor")}
              </CardTitle>
              <MonitorTypesPopover />
            </div>
            <CardDescription className="mt-1">
              {description ||
                (editMode
                  ? "Update monitor configuration"
                  : "Configure a new uptime monitor")}
            </CardDescription>
          </div>
          {editMode && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowLocationSettings(true)}
                disabled={isSubmitting}
                className="flex items-center gap-2"
              >
                <MapPin className="h-4 w-4" />
                Configure Locations
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAlerts(true)}
                disabled={isSubmitting}
                className="flex items-center gap-2"
              >
                <BellIcon className="h-4 w-4" />
                Configure Alerts
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Monitor Name and Check Interval - aligned on same line */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left column - Monitor Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel>Monitor Name</FormLabel>
                      <FormControl>
                        <Input placeholder="My Website" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Right column - Check Interval with Info Icon */}
                <FormField
                  control={form.control}
                  name="interval"
                  render={({ field }) => {
                    // Use different interval options based on monitor type
                    const checkIntervalOptions =
                      type === "synthetic_test"
                        ? syntheticCheckIntervalOptions
                        : standardCheckIntervalOptions;

                    return (
                      <FormItem className="space-y-2">
                        <div className="flex items-center gap-2 mb-0">
                          <FormLabel>Check Interval</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                aria-label="Check interval tips"
                              >
                                <Info className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              className="w-56 text-xs"
                              side="right"
                              align="start"
                            >
                              <div className="space-y-2">
                                <p className="font-semibold text-foreground">
                                  Recommended intervals:
                                </p>
                                <ul className="space-y-1.5 text-muted-foreground">
                                  <li className="flex items-start gap-2">
                                    <span className="text-foreground font-medium">
                                      Critical:
                                    </span>
                                    <span>5-10 min</span>
                                  </li>
                                  <li className="flex items-start gap-2">
                                    <span className="text-foreground font-medium">
                                      Standard:
                                    </span>
                                    <span>15-30 min</span>
                                  </li>
                                  <li className="flex items-start gap-2">
                                    <span className="text-foreground font-medium">
                                      Low-priority:
                                    </span>
                                    <span>1+ hour</span>
                                  </li>
                                </ul>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select interval" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {checkIntervalOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>

              {/* Test Selector for synthetic monitors - full width */}
              {type === "synthetic_test" && (
                <TestSelector
                  selectedTests={selectedTests}
                  onTestsSelected={(tests) => {
                    setSelectedTests(tests);
                    // Update form field with first test ID
                    if (tests.length > 0) {
                      form.setValue("syntheticConfig_testId", tests[0].id, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      void form.trigger("syntheticConfig_testId");
                      // Auto-update monitor name if empty
                      const currentName = form.getValues("name");
                      if (!currentName) {
                        form.setValue("name", tests[0].name);
                      }
                    } else {
                      form.setValue("syntheticConfig_testId", "", {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      void form.trigger("syntheticConfig_testId");
                    }
                  }}
                  buttonLabel="Select Test"
                  emptyStateMessage="No test selected"
                  required={true}
                  hideButton={selectedTests.length > 0}
                  singleSelection
                  excludeTypes={["performance"]}
                  dialogTitle="Select Test"
                  dialogDescription="Choose a test to monitor"
                  maxSelectionLabel="Select 1 playwright test"
                />
              )}

              {/* Target field for non-synthetic monitors */}
              {type !== "synthetic_test" && (
                <FormField
                  control={form.control}
                  name="target"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={
                            type
                              ? targetPlaceholders[type]
                              : "Select Check Type for target hint"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Conditional fields based on type (formerly method) */}
              {type === "http_request" && (
                <div className="space-y-4 pt-2">
                  {/* <h3 className=" font-medium">HTTP Request Settings</h3> */}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="httpConfig_method"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>HTTP Method</FormLabel>
                          <FormControl>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a method" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {[
                                  "GET",
                                  "POST",
                                  "PUT",
                                  "DELETE",
                                  "PATCH",
                                  "HEAD",
                                  "OPTIONS",
                                ].map((method) => (
                                  <SelectItem key={method} value={method}>
                                    <div className="flex items-center">
                                      <span>{method}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Expected Status Code */}
                    <FormField
                      control={form.control}
                      name="httpConfig_expectedStatusCodes"
                      render={({ field }) => {
                        const presetValues = [
                          "200-299",
                          "300-399",
                          "400-499",
                          "500-599",
                        ];
                        const currentValue = field.value || "200-299";

                        // Determine if current value is a preset or custom
                        // Determine if current value is a preset or custom

                        const handleDropdownChange = (value: string) => {
                          if (value === "custom") {
                            setIsCustomStatusCode(true);
                            // Don't clear the field, keep current value for editing
                            if (
                              !field.value ||
                              presetValues.includes(field.value)
                            ) {
                              field.onChange("200"); // Default to a single code for custom
                            }
                          } else {
                            setIsCustomStatusCode(false);
                            field.onChange(value);
                          }
                        };

                        const handleInputChange = (
                          e: React.ChangeEvent<HTMLInputElement>
                        ) => {
                          const newValue = e.target.value;
                          field.onChange(newValue);

                          // Auto-detect if the value matches a preset
                          if (presetValues.includes(newValue)) {
                            setIsCustomStatusCode(false);
                          } else if (newValue && !isCustomStatusCode) {
                            setIsCustomStatusCode(true);
                          }
                        };

                        // Determine dropdown value - ensure proper synchronization
                        const dropdownValue = isCustomStatusCode
                          ? "custom"
                          : presetValues.includes(currentValue)
                            ? currentValue
                            : "200-299";

                        return (
                          <FormItem>
                            <FormLabel>Expected Status Codes</FormLabel>
                            <div className="flex items-center space-x-2">
                              <FormControl className="flex-grow">
                                <Input
                                  placeholder="e.g., 200, 404, 500-599"
                                  value={currentValue}
                                  onChange={handleInputChange}
                                  disabled={!isCustomStatusCode}
                                  className={
                                    !isCustomStatusCode
                                      ? "bg-muted cursor-not-allowed"
                                      : ""
                                  }
                                />
                              </FormControl>
                              <Select
                                value={dropdownValue}
                                onValueChange={handleDropdownChange}
                              >
                                <SelectTrigger className="w-[180px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {statusCodePresets.map((preset) => (
                                    <SelectItem
                                      key={preset.value}
                                      value={preset.value}
                                    >
                                      {preset.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {/* <FormDescription>
                              {isCustomStatusCode ? "Enter specific status codes (e.g., 200, 404, 500-599)" : "Current selection: " + (statusCodePresets.find(p => p.value === currentValue)?.label || "Any 2xx (Success)")}
                            </FormDescription> */}
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ">
                    <FormField
                      control={form.control}
                      name="httpConfig_headers"
                      render={({ field }) => (
                        <FormItem
                          className={`${httpMethod === "POST" ||
                            httpMethod === "PUT" ||
                            httpMethod === "PATCH"
                            ? ""
                            : "md:col-span-2"
                            }`}
                        >
                          <FormLabel>
                            HTTP Headers{" "}
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              Optional
                            </span>
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder='{ "Authorization": "Bearer ..." }'
                              {...field}
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {(httpMethod === "POST" ||
                      httpMethod === "PUT" ||
                      httpMethod === "PATCH") && (
                        <FormField
                          control={form.control}
                          name="httpConfig_body"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>HTTP Body</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Request body (e.g., JSON)"
                                  {...field}
                                  rows={3}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                  </div>

                  {/* Authentication and Response Content Validation sections side by side */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
                    {/* Authentication Section */}
                    <Card>
                      <Collapsible
                        open={isAuthSectionOpen}
                        onOpenChange={setIsAuthSectionOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                            <div className="flex items-center space-x-2">
                              {isAuthSectionOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              <CardTitle className="text-base">
                                Authentication
                              </CardTitle>
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                Optional
                              </span>
                            </div>
                            <CardDescription className="text-sm">
                              Configure authentication credentials for protected
                              endpoints
                            </CardDescription>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-0 space-y-4">
                            <FormField
                              control={form.control}
                              name="httpConfig_authType"
                              render={({ field }) => (
                                <FormItem className="mb-4">
                                  <FormLabel>Authentication Type</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value || "none"}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select authentication type" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="none">None</SelectItem>
                                      <SelectItem value="basic">
                                        Basic Auth
                                      </SelectItem>
                                      <SelectItem value="bearer">
                                        Bearer Token
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {authType === "basic" && (
                              <div className="space-y-4 mb-4">
                                <FormField
                                  control={form.control}
                                  name="httpConfig_authUsername"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Username</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder="Enter username"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="httpConfig_authPassword"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Password</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="password"
                                          placeholder="Enter password"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            )}

                            {authType === "bearer" && (
                              <div className="mb-4">
                                <FormField
                                  control={form.control}
                                  name="httpConfig_authToken"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Bearer Token</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="password"
                                          placeholder="Enter bearer token"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            )}
                          </CardContent>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>

                    {/* Response Content Validation Section */}
                    <Card>
                      <Collapsible
                        open={isKeywordSectionOpen}
                        onOpenChange={setIsKeywordSectionOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                            <div className="flex items-center space-x-2">
                              {isKeywordSectionOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              <CardTitle className="text-base">
                                Response Content Validation
                              </CardTitle>
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                Optional
                              </span>
                            </div>
                            <CardDescription className="text-sm">
                              Validate response content by checking for specific
                              keywords or text
                            </CardDescription>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-0 space-y-4">
                            <FormField
                              control={form.control}
                              name="httpConfig_keywordInBody"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Keyword</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="success"
                                      {...field}
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="httpConfig_keywordShouldBePresent"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Keyword Should Be</FormLabel>
                                  <FormControl>
                                    <Select
                                      onValueChange={(value) =>
                                        field.onChange(
                                          value === "true"
                                            ? true
                                            : value === "false"
                                              ? false
                                              : undefined
                                        )
                                      }
                                      value={
                                        typeof field.value === "boolean"
                                          ? field.value.toString()
                                          : "true"
                                      }
                                    >
                                      <FormControl>
                                        <SelectTrigger className="w-full">
                                          <SelectValue placeholder="Present or Absent?" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="true">
                                          Present
                                        </SelectItem>
                                        <SelectItem value="false">
                                          Absent
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </CardContent>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>
                  </div>
                </div>
              )}

              {type === "website" && (
                <div className="space-y-4 pt-4">
                  {/* <h3 className="text-base font-medium">Website Check Settings</h3> */}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Expected Status Code */}
                    <FormField
                      control={form.control}
                      name="httpConfig_expectedStatusCodes"
                      render={({ field }) => {
                        const presetValues = [
                          "200-299",
                          "300-399",
                          "400-499",
                          "500-599",
                        ];
                        const currentValue = field.value || "200-299";

                        // Determine if current value is a preset or custom
                        // Determine if current value is a preset or custom

                        const handleDropdownChange = (value: string) => {
                          if (value === "custom") {
                            setIsCustomStatusCode(true);
                            // Don't clear the field, keep current value for editing
                            if (
                              !field.value ||
                              presetValues.includes(field.value)
                            ) {
                              field.onChange("200"); // Default to a single code for custom
                            }
                          } else {
                            setIsCustomStatusCode(false);
                            field.onChange(value);
                          }
                        };

                        const handleInputChange = (
                          e: React.ChangeEvent<HTMLInputElement>
                        ) => {
                          const newValue = e.target.value;
                          field.onChange(newValue);

                          // Auto-detect if the value matches a preset
                          if (presetValues.includes(newValue)) {
                            setIsCustomStatusCode(false);
                          } else if (newValue && !isCustomStatusCode) {
                            setIsCustomStatusCode(true);
                          }
                        };

                        // Determine dropdown value - ensure proper synchronization
                        const dropdownValue = isCustomStatusCode
                          ? "custom"
                          : presetValues.includes(currentValue)
                            ? currentValue
                            : "200-299";

                        return (
                          <FormItem>
                            <FormLabel>Expected Status Codes</FormLabel>
                            <div className="flex items-center space-x-2">
                              <FormControl className="flex-grow">
                                <Input
                                  placeholder="e.g., 200, 404, 500-599"
                                  value={currentValue}
                                  onChange={handleInputChange}
                                  disabled={!isCustomStatusCode}
                                  className={
                                    !isCustomStatusCode
                                      ? "bg-muted cursor-not-allowed"
                                      : ""
                                  }
                                />
                              </FormControl>
                              <Select
                                value={dropdownValue}
                                onValueChange={handleDropdownChange}
                              >
                                <SelectTrigger className="w-[180px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {statusCodePresets.map((preset) => (
                                    <SelectItem
                                      key={preset.value}
                                      value={preset.value}
                                    >
                                      {preset.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <FormDescription>
                              {isCustomStatusCode
                                ? "Enter specific status codes (e.g., 200, 404, 500-599)"
                                : "Current selection: " +
                                (statusCodePresets.find(
                                  (p) => p.value === currentValue
                                )?.label || "Any 2xx (Success)")}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />

                    {/* SSL Certificate Check Section - Compact and Inline for Website */}
                    <div className="p-3 border rounded-lg bg-muted/10">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Shield className="h-4 w-4 text-green-500" />
                            <span className="text-sm font-medium">
                              SSL Check
                            </span>
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              Optional
                            </span>
                          </div>

                          <FormField
                            control={form.control}
                            name="websiteConfig_enableSslCheck"
                            render={({ field }) => (
                              <FormItem>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={(checked) => {
                                      field.onChange(checked);
                                    }}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        {form.watch("websiteConfig_enableSslCheck") && (
                          <div className="flex items-center space-x-2 pt-2 border-t">
                            <span className="text-xs text-muted-foreground">
                              Alert in
                            </span>
                            <FormField
                              control={form.control}
                              name="websiteConfig_sslDaysUntilExpirationWarning"
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      placeholder="30"
                                      className="w-16 h-7 text-xs"
                                      {...field}
                                      value={field.value || ""}
                                      onChange={(e) => {
                                        const newValue = e.target.value
                                          ? parseInt(e.target.value)
                                          : 30;
                                        field.onChange(newValue);
                                      }}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <span className="text-xs text-muted-foreground">
                              days
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Authentication and Content Validation sections side by side for Website */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
                    {/* Authentication Section */}
                    <Card>
                      <Collapsible
                        open={isAuthSectionOpen}
                        onOpenChange={setIsAuthSectionOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-2">
                            <div className="flex items-center space-x-2">
                              {isAuthSectionOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              <CardTitle className="text-base">
                                Authentication
                              </CardTitle>
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                Optional
                              </span>
                            </div>
                            <CardDescription className="text-sm">
                              Configure authentication credentials for protected
                              websites
                            </CardDescription>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-0 space-y-4">
                            <FormField
                              control={form.control}
                              name="httpConfig_authType"
                              render={({ field }) => (
                                <FormItem className="mb-4">
                                  <FormLabel>Authentication Type</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value || "none"}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select authentication type" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="none">None</SelectItem>
                                      <SelectItem value="basic">
                                        Basic Auth
                                      </SelectItem>
                                      <SelectItem value="bearer">
                                        Bearer Token
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {authType === "basic" && (
                              <div className="space-y-4 mb-4">
                                <FormField
                                  control={form.control}
                                  name="httpConfig_authUsername"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Username</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder="Enter username"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="httpConfig_authPassword"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Password</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="password"
                                          placeholder="Enter password"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            )}

                            {authType === "bearer" && (
                              <div className="mb-4">
                                <FormField
                                  control={form.control}
                                  name="httpConfig_authToken"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Bearer Token</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="password"
                                          placeholder="Enter bearer token"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>
                            )}
                          </CardContent>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>

                    {/* Content Validation Section */}
                    <Card>
                      <Collapsible
                        open={isKeywordSectionOpen}
                        onOpenChange={setIsKeywordSectionOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-2">
                            <div className="flex items-center space-x-2">
                              {isKeywordSectionOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              <CardTitle className="text-base">
                                Content Validation
                              </CardTitle>
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                Optional
                              </span>
                            </div>
                            <CardDescription className="text-sm">
                              Check if specific text or keywords exist on your
                              website
                            </CardDescription>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-0 space-y-4">
                            <FormField
                              control={form.control}
                              name="httpConfig_keywordInBody"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Keyword</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="Welcome"
                                      {...field}
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="httpConfig_keywordShouldBePresent"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Keyword Should Be</FormLabel>
                                  <FormControl>
                                    <Select
                                      onValueChange={(value) =>
                                        field.onChange(
                                          value === "true"
                                            ? true
                                            : value === "false"
                                              ? false
                                              : undefined
                                        )
                                      }
                                      value={
                                        typeof field.value === "boolean"
                                          ? field.value.toString()
                                          : "true"
                                      }
                                    >
                                      <FormControl>
                                        <SelectTrigger className="w-full">
                                          <SelectValue placeholder="Present or Absent?" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="true">
                                          Present
                                        </SelectItem>
                                        <SelectItem value="false">
                                          Absent
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </CardContent>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>
                  </div>
                </div>
              )}

              {type === "port_check" && (
                <div className="space-y-4 pt-4">
                  {/* <h3 className="text-lg font-medium">Port Check Settings</h3> */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="portConfig_port"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Port</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="443"
                              {...field}
                              onChange={(e) => {
                                const value = parseInt(e.target.value);
                                if (!isNaN(value)) {
                                  field.onChange(value);
                                } else {
                                  field.onChange(443); // Default port
                                }
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="portConfig_protocol"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Protocol</FormLabel>
                          <FormControl>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a protocol" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {["tcp", "udp"].map((protocol) => (
                                  <SelectItem key={protocol} value={protocol}>
                                    <div className="flex items-center">
                                      <span>{protocol.toUpperCase()}</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel || (() => router.push("/monitors"))}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    (editMode && !hasAnyConfigChanged()) ||
                    (!editMode && !canCreate)
                  }
                  className="flex items-center"
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <SaveIcon className="mr-2 h-4 w-4" />
                  )}
                  {hideAlerts
                    ? "Next: Alerts"
                    : editMode
                      ? "Update Monitor"
                      : "Create"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
