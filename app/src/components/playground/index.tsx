"use client";
import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CodeEditor } from "./code-editor";
import { TestForm } from "./test-form";
import { ValidationError } from "./validation-error";
import { Loader2Icon, ZapIcon, Text, Code2, X } from "lucide-react";
import * as z from "zod";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { editor } from "monaco-editor";
import { ScriptType } from "@/lib/script-service";
import { ReportViewer } from "@/components/shared/report-viewer";
import { useProjectContext } from "@/hooks/use-project-context";
import { canRunTests } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import RuntimeInfoPopover from "./runtime-info-popover";
import { AIFixButton } from "./ai-fix-button";
import { AIDiffViewer } from "./ai-diff-viewer";
import { GuidanceModal } from "./guidance-modal";
import { AICreateButton } from "./ai-create-button";
import { AICreateViewer } from "./ai-create-viewer";
import { PlaywrightLogo } from "../logo/playwright-logo";
import { K6Logo } from "../logo/k6-logo";
import { PerformanceTestReport } from "./performance-test-report";
import {
  LocationSelectionDialog,
  PerformanceLocation,
} from "./location-selection-dialog";
import { TemplateDialog } from "./template-dialog";
import type { TestPriority, TestType } from "@/db/schema/types";
import { notifyExecutionsChanged } from "@/hooks/use-executions";
import { useSession } from "@/utils/auth-client";
import { getRequirement } from "@/actions/requirements";

const extractCodeFromResponse = (rawText: string): string => {
  if (!rawText) {
    return "";
  }

  const fencedBlockMatch = rawText.match(/```(?:[\w+-]+)?\s*([\s\S]*?)```/);
  if (fencedBlockMatch) {
    return fencedBlockMatch[1].trimStart();
  }

  const fenceStartIndex = rawText.indexOf("```");
  if (fenceStartIndex !== -1) {
    const afterFence = rawText.slice(fenceStartIndex + 3);
    const withoutLang = afterFence.replace(/^(?:[\w+-]+\s*)?/, "");
    return withoutLang.trimStart();
  }

  const sectionMatch = rawText.match(
    /(?:GENERATED_SCRIPT|FIXED_SCRIPT):\s*([\s\S]*)/i
  );
  if (sectionMatch) {
    return sectionMatch[1].trimStart();
  }

  return rawText.trimStart();
};

const VALID_TEST_TYPES: TestType[] = [
  "browser",
  "api",
  "database",
  "custom",
  "performance",
];

const VALID_TEST_PRIORITIES: TestPriority[] = ["low", "medium", "high"];

const normalizeTestTypeValue = (value: unknown): TestType =>
  VALID_TEST_TYPES.includes(value as TestType)
    ? (value as TestType)
    : ("browser" as TestType);

const normalizePriorityValue = (value: unknown): TestPriority =>
  VALID_TEST_PRIORITIES.includes(value as TestPriority)
    ? (value as TestPriority)
    : ("medium" as TestPriority);

// Define our own TestCaseFormData interface
interface TestCaseFormData {
  title: string;
  description: string | null;
  priority: TestPriority;
  type: TestType;
  script?: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  location?: PerformanceLocation | null;
}

interface PlaygroundProps {
  initialTestData?: {
    id?: string;
    title: string;
    description: string | null;
    script: string;
    priority: TestPriority;
    type: TestType;
    updatedAt?: string;
    createdAt?: string;
    location?: PerformanceLocation | null;
  };
  initialTestId?: string;
}

const Playground: React.FC<PlaygroundProps> = ({
  initialTestData,
  initialTestId,
}) => {
  const initialResolvedType = normalizeTestTypeValue(initialTestData?.type);
  const initialResolvedPriority = normalizePriorityValue(
    initialTestData?.priority
  );
  // Permission checking
  const { currentProject } = useProjectContext();
  const userCanRunTests = currentProject?.userRole
    ? canRunTests(normalizeRole(currentProject.userRole))
    : false;
  // Get user ID from session (Better Auth) instead of manual fetch
  // This leverages the existing session cache and avoids duplicate API calls
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const searchParams = useSearchParams();

  const initialPerformanceLocation: PerformanceLocation | null =
    initialResolvedType === "performance" && initialTestData
      ? ((initialTestData.location as PerformanceLocation) ??
        ("global" as PerformanceLocation))
      : null;

  // Suppress Monaco editor cancellation errors (harmless during component lifecycle)
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (
        event.reason?.type === "cancelation" &&
        event.reason?.msg === "operation is manually canceled"
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () =>
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection
      );
  }, []);

  const [activeTab, setActiveTab] = useState<string>("editor");
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isReportLoading, setIsReportLoading] = useState(false);

  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [performanceRunId, setPerformanceRunId] = useState<string | null>(null);
  const [performanceLocation, setPerformanceLocation] =
    useState<PerformanceLocation>(initialPerformanceLocation ?? "global");
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  // Only set testId from initialTestId if we're on a specific test page
  // Always ensure testId is null when on the main playground page
  const [testId, setTestId] = useState<string | null>(initialTestId || null);
  // Separate state for tracking the current test execution ID (for AI Fix functionality)
  const [executionTestId, setExecutionTestId] = useState<string | null>(null);
  const [executionTestType, setExecutionTestType] = useState<string | null>(
    null
  ); // Track test type (browser/performance)
  const [completedTestIds, setCompletedTestIds] = useState<string[]>([]);
  const [editorContent, setEditorContent] = useState(
    initialTestData?.script || ""
  );
  const [initialEditorContent, setInitialEditorContent] = useState(
    initialTestData?.script || ""
  );
  const [initialFormValues, setInitialFormValues] = useState<
    Partial<TestCaseFormData>
  >(
    initialTestData
      ? {
        title: initialTestData.title,
        description: initialTestData.description,
        priority: initialResolvedPriority,
        type: initialResolvedType,
        updatedAt: initialTestData.updatedAt || undefined,
        createdAt: initialTestData.createdAt || undefined,
        location: initialPerformanceLocation,
      }
      : {}
  );
  const [testCase, setTestCase] = useState<TestCaseFormData>({
    title: initialTestData?.title || "",
    description: initialTestData?.description || "",
    priority: initialResolvedPriority,
    type: initialResolvedType,
    script: initialTestData?.script || "",
    updatedAt: initialTestData?.updatedAt || undefined,
    createdAt: initialTestData?.createdAt || undefined,
    location: initialPerformanceLocation,
  });

  // Create empty errors object for TestForm
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Validation state with strict tracking
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationLine, setValidationLine] = useState<number | undefined>(
    undefined
  );
  const [validationColumn, setValidationColumn] = useState<number | undefined>(
    undefined
  );
  const [validationErrorType, setValidationErrorType] = useState<
    string | undefined
  >(undefined);
  const [isValid, setIsValid] = useState<boolean>(false); // Default to false for safety
  const [hasValidated, setHasValidated] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [lastValidatedScript, setLastValidatedScript] = useState<string>(""); // Track last validated script

  // Test execution status tracking
  const [testExecutionStatus, setTestExecutionStatus] = useState<
    "none" | "passed" | "failed"
  >("failed"); // Default to failed-safe until a passing run is confirmed
  const [lastExecutedScript, setLastExecutedScript] = useState<string>(""); // Track last executed script
  const [isAIAnalyzing, setIsAIAnalyzing] = useState(false); // Track AI Fix analyzing state

  // AI Fix functionality state
  const [showAIDiff, setShowAIDiff] = useState(false);
  const [aiFixedScript, setAIFixedScript] = useState<string>("");
  const [aiExplanation, setAIExplanation] = useState<string>("");
  const [showGuidanceModal, setShowGuidanceModal] = useState(false);
  const [guidanceMessage, setGuidanceMessage] = useState<string>("");
  const [isStreamingAIFix, setIsStreamingAIFix] = useState(false);
  const [streamingFixContent, setStreamingFixContent] = useState<string>("");

  // AI Create functionality state
  const [showAICreateDiff, setShowAICreateDiff] = useState(false);
  const [aiGeneratedScript, setAIGeneratedScript] = useState<string>("");
  const [aiCreateExplanation, setAICreateExplanation] = useState<string>("");
  const [isAICreating, setIsAICreating] = useState(false);
  const [isStreamingAICreate, setIsStreamingAICreate] = useState(false);
  const [streamingCreateContent, setStreamingCreateContent] =
    useState<string>("");

  // AI Prompt pre-filling from Requirement
  const [aiPrompt, setAiPrompt] = useState<string | undefined>(undefined);
  const [aiAutoOpen, setAiAutoOpen] = useState(false);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [linkedRequirement, setLinkedRequirement] = useState<{ id: string; title: string; externalUrl?: string | null } | null>(null);

  // Browser recording banner - show for new browser tests (no existing testId)
  const [showRecordingBanner, setShowRecordingBanner] = useState(true);

  useEffect(() => {
    const requirementId = searchParams.get("requirementId");
    if (requirementId) {
      // For browser tests, don't auto-open AI dialog - show recording instructions instead
      const isBrowserTest = testCase.type === "browser";

      if (!isBrowserTest) {
        // Immediately open the dialog and show loading state for non-browser tests
        setAiAutoOpen(true);
        setIsLoadingPrompt(true);
      }

      getRequirement(requirementId).then((req) => {
        if (req) {
          setLinkedRequirement({
            id: req.id,
            title: req.title,
            externalUrl: req.externalUrl
          });

          // Construct a detailed prompt based on the requirement
          const type = testCase.type || "test";

          // Build prompt parts conditionally to avoid empty lines
          const promptParts: string[] = [];
          
          // Header
          promptParts.push(`Create a custom test for the following requirement:`);
          
          // Title (always present)
          promptParts.push(`Title: ${req.title}`);
          
          // Description (always include, with fallback)
          const description = req.description?.trim() || "No description provided.";
          promptParts.push(`Description: ${description}`);
          
          // Optional source document info (only if present)
          if (req.sourceDocumentName) {
            promptParts.push(`Source Document: ${req.sourceDocumentName}`);
          }
          if (req.sourceSection) {
            promptParts.push(`Section: ${req.sourceSection}`);
          }

          // Type-specific required info hints
          if (type === "api") {
            promptParts.push(`\nRequired Information (fill in if not in description above):`);
            promptParts.push(`- Target Endpoint/URL`);
            promptParts.push(`- HTTP Method (GET/POST/PUT/DELETE)`);
            promptParts.push(`- Request Payload (if applicable)`);
            promptParts.push(`- Authentication method`);
          } else if (type === "database") {
            promptParts.push(`\nRequired Information (fill in if not in description above):`);
            promptParts.push(`- Connection configuration`);
            promptParts.push(`- SQL query to execute`);
            promptParts.push(`- Expected result schema`);
          } else if (type === "performance") {
            promptParts.push(`\nRequired Information (fill in if not in description above):`);
            promptParts.push(`- Target URL`);
            promptParts.push(`- Virtual users (VUs) and duration`);
            promptParts.push(`- Performance thresholds (e.g., p95 < 500ms)`);
          }

          // Instructions
          promptParts.push(`\nPlease generate a robust test script covering success and error scenarios. Use standard placeholders (e.g., 'https://api.example.com') for any missing details and add TODO comments indicating where real values are needed.`);
          
          const prompt = promptParts.join('\n');
          setAiPrompt(prompt);
        }
      }).catch(err => console.error("Failed to fetch requirement for AI prompt:", err))
        .finally(() => setIsLoadingPrompt(false));
    } else {
      setAiPrompt(undefined);
      setAiAutoOpen(false);
      setIsLoadingPrompt(false);
    }
  }, [searchParams, testCase.type]); // Update prompt if type changes while requirement is loaded

  // Derived state: is current script validated and passed?
  const isCurrentScriptValidated =
    hasValidated && isValid && editorContent === lastValidatedScript;
  const isCurrentScriptExecutedSuccessfully =
    testExecutionStatus === "passed" && editorContent === lastExecutedScript;
  const isPerformanceMode = testCase.type === "performance";
  const isCurrentScriptReadyToSave =
    isCurrentScriptValidated && isCurrentScriptExecutedSuccessfully;
  const aiFixVisible =
    testExecutionStatus === "failed" &&
    !isRunning &&
    !isValidating &&
    !isReportLoading &&
    userCanRunTests &&
    !!executionTestId;

  // Clear validation state when script changes
  const resetValidationState = () => {
    setValidationError(null);
    setValidationLine(undefined);
    setValidationColumn(undefined);
    setValidationErrorType(undefined);
    setIsValid(false);
    setHasValidated(false);
    // Don't reset lastValidatedScript here - only when validation passes
  };

  // Clear test execution state when script changes
  const resetTestExecutionState = () => {
    setTestExecutionStatus("failed");
    setExecutionTestId(null); // Clear execution test ID for new script
    // Don't reset lastExecutedScript here - only when test passes
    setPerformanceRunId(null);
  };

  // Clear report state when test type changes
  const resetReportState = () => {
    setReportUrl(null);
    setPerformanceRunId(null);
    setActiveTab("editor");
  };

  // Editor reference
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // Track if validation has already been reset for this test (to avoid resetting after successful run)
  const validationResetRef = useRef(false);
  // Track the last editor content to prevent spurious onChange events from resetting state
  // Monaco editor sometimes fires onChange during re-renders even when content hasn't changed
  const lastEditorContentRef = useRef<string>(editorContent);


  // Manual validation function (called only on run/submit)
  const validateScript = async (
    script: string
  ): Promise<{
    valid: boolean;
    error?: string;
    line?: number;
    column?: number;
    errorType?: string;
  }> => {
    if (!script || script.trim() === "") {
      return { valid: true }; // Empty script is considered valid for now
    }

    setIsValidating(true);
    try {
      const response = await fetch("/api/validate-script", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ script }),
      });

      const result = await response.json();

      if (!response.ok || !result.valid) {
        return {
          valid: false,
          error: result.error || "Unknown validation error",
          line: result.line,
          column: result.column,
          errorType: result.errorType,
        };
      }

      return { valid: true };
    } catch (error) {
      console.error("Validation error:", error);
      return {
        valid: false,
        error: "Unable to validate script - validation service unavailable",
      };
    } finally {
      setIsValidating(false);
    }
  };

  // Reset testId when on the main playground page
  useEffect(() => {
    if (window.location.pathname === "/playground") {
      setTestId(null);
    }
  }, []);

  // Initialize validation state for existing test data (only once per test load)
  useEffect(() => {
    if (initialTestData && initialTestData.script && !validationResetRef.current) {
      // For existing tests, consider them as needing revalidation for security
      resetValidationState();
      setLastValidatedScript(""); // Force revalidation of existing scripts
      validationResetRef.current = true;
    }
  }, [initialTestData]);

  // Reset the validation ref when the test ID changes (loading a different test)
  useEffect(() => {
    validationResetRef.current = false;
  }, [initialTestId]);

  // Sync the editor content ref when editorContent changes programmatically
  // (e.g., from loadTestById, template selection, AI generation)
  // This ensures the ref stays accurate for spurious onChange detection
  useEffect(() => {
    lastEditorContentRef.current = editorContent;
  }, [editorContent]);

  // REMOVED: loadTestById function since initialTestData is already passed via props
  // Test data is fetched once in page.tsx using useTest hook (React Query cached)
  // and passed down via initialTestData prop - no need for duplicate fetching

  // Monitor URL search params changes and potentially load scripts/set type
  useEffect(() => {
    const scriptTypeParam = searchParams.get("scriptType") as TestType | null;

    if (!initialTestId) {
      setTestId(null);

      const defaultType = "browser" as TestType;
      const typeToSet =
        scriptTypeParam &&
          ["browser", "api", "custom", "database", "performance"].includes(
            scriptTypeParam
          )
          ? scriptTypeParam
          : defaultType;

      // Reset report state when test type changes
      if (typeToSet !== testCase.type) {
        resetReportState();
        resetValidationState();
        resetTestExecutionState();
      }

      // Track if type is actually changing (used by loadScriptForType)
      const isTypeChanging = typeToSet !== testCase.type;

      setTestCase((prev) => ({
        ...prev,
        type: typeToSet,
        location:
          typeToSet === "performance"
            ? (performanceLocation ?? prev.location ?? "global")
            : null,
      }));

      if (typeToSet === "performance" && !performanceLocation) {
        setPerformanceLocation("global");
      }

      // Load sample script when:
      // 1. Type is CHANGING (user switched from browser to performance, etc.)
      // 2. OR the editor is empty (new playground session)
      // Do NOT load when only performanceLocation changes (during k6 runs)
      const loadScriptForType = async () => {
        const currentContent = lastEditorContentRef.current;
        const hasExistingContent = currentContent && currentContent.trim().length > 0;
        const shouldLoadScript = isTypeChanging || !hasExistingContent;

        if (typeToSet && shouldLoadScript) {
          try {
            const { getSampleScript } = await import("@/lib/script-service");
            const scriptContent = getSampleScript(typeToSet as ScriptType);
            if (scriptContent === null || scriptContent === undefined) {
            }
            setEditorContent(scriptContent || ""); // Ensure we set empty string if null/undefined
            setInitialEditorContent(scriptContent || "");
            setTestCase((prev) => ({ ...prev, script: scriptContent || "" }));
          } catch {
            toast.error("Failed to load default script content.");
          }
        }
      };
      loadScriptForType();
    }
  }, [searchParams, initialTestId, performanceLocation, testCase.type]);

  // Handle initialTestData when provided from server-side
  useEffect(() => {
    if (initialTestData) {
      const resolvedType = normalizeTestTypeValue(initialTestData.type);
      const resolvedPriority = normalizePriorityValue(initialTestData.priority);
      // If we have initial test data from the server, use it
      // Update the initial form values to match the loaded test
      setInitialFormValues({
        title: initialTestData.title,
        description: initialTestData.description || undefined,
        priority: resolvedPriority,
        type: resolvedType,
        updatedAt: initialTestData.updatedAt || undefined,
        createdAt: initialTestData.createdAt || undefined,
        location:
          resolvedType === "performance"
            ? ((initialTestData.location as PerformanceLocation) ?? "global")
            : null,
      });

      if (resolvedType === "performance") {
        const resolvedLocation: PerformanceLocation =
          (initialTestData.location as PerformanceLocation) ?? "global";
        setPerformanceLocation(resolvedLocation);
        setTestCase((prev) => ({
          ...prev,
          location: resolvedLocation,
        }));
      }
    }
  }, [initialTestData]);

  // Force Monaco editor to initialize on client side even with script params
  useEffect(() => {
    // This triggers a re-render once on the client side to ensure Monaco loads
    const timer = setTimeout(() => {
      if (typeof window !== "undefined" && !editorRef.current) {
        // Force a re-render by making a small state update
        setEditorContent((prev) => prev);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      const model = editor.getModel();
      if (model) {
        const disposable = model.onDidChangeContent(() => {
          const value = editor.getValue() || "";
          setEditorContent(value);
          // Keep code and script fields in sync
          setTestCase((prev: TestCaseFormData) => ({
            ...prev,
            script: value,
          }));
        });
        return () => disposable.dispose();
      }
    }
  }, []);

  const validateForm = () => {
    try {
      // Before validation, ensure script field is synced with code field
      // and handle null description
      const validationData = {
        ...testCase,
        script: editorContent,
        description: testCase.description || "", // Convert null to empty string for validation
      };
      const normalizedType = normalizeTestTypeValue(validationData.type);
      const normalizedPriority = normalizePriorityValue(
        validationData.priority
      );

      if (
        normalizedType !== testCase.type ||
        normalizedPriority !== testCase.priority
      ) {
        setTestCase((prev: TestCaseFormData) => ({
          ...prev,
          type: normalizedType,
          priority: normalizedPriority,
        }));
      }

      const mergedValidationData = {
        ...validationData,
        type: normalizedType,
        priority: normalizedPriority,
      };

      const newErrors: Record<string, string> = {};

      // Validate title
      if (
        !mergedValidationData.title ||
        mergedValidationData.title.trim() === ""
      ) {
        newErrors.title = "Title is required";
      }

      // Validate description - make it mandatory
      if (
        !mergedValidationData.description ||
        mergedValidationData.description.trim() === ""
      ) {
        newErrors.description = "Description is required";
      }

      // Validate script
      if (
        !mergedValidationData.script ||
        mergedValidationData.script.trim() === ""
      ) {
        newErrors.script = "Test script is required";
      }

      // Validate type - explicit check for missing type without comparing to empty string
      if (!mergedValidationData.type) {
        newErrors.type = "Test type is required";
      }

      // Validate priority - explicit check for missing priority without comparing to empty string
      if (!mergedValidationData.priority) {
        newErrors.priority = "Priority is required";
      }

      if (
        (mergedValidationData.type === "performance" ||
          testCase.type === "performance") &&
        !(testCase.location || performanceLocation)
      ) {
        newErrors.location = "Execution location is required";
      }

      // Set errors state
      setErrors(newErrors);

      // Return true if no errors
      return Object.keys(newErrors).length === 0;
    } catch (error) {
      console.error("Error validating form:", error);
      if (error instanceof z.ZodError) {
        const formattedErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            formattedErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(formattedErrors);
      }
      return false;
    }
  };

  const executeQueuedTest = async (options?: {
    location?: PerformanceLocation;
  }) => {
    if (isPerformanceMode) {
      setPerformanceRunId(null);
      setReportUrl(null);
    } else {
      setIsReportLoading(true);
    }

    setIsRunning(true);

    try {
      const payload: Record<string, unknown> = {
        id: testId,
        script: editorContent,
        testType: testCase.type,
      };

      const resolvedLocation =
        options?.location ??
        (testCase.type === "performance"
          ? testCase.location || performanceLocation
          : undefined);

      if (testCase.type === "performance" && resolvedLocation) {
        payload.location = resolvedLocation;
        setPerformanceLocation(resolvedLocation as PerformanceLocation);
        setTestCase((prev) => ({
          ...prev,
          location: resolvedLocation as PerformanceLocation,
        }));
      }

      const res = await fetch(`/api/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (res.ok && result.testId) {
        const responseTestType: string =
          (result.testType as string) || "browser";

        // Notify executions hook to refresh immediately (instant UI update)
        notifyExecutionsChanged();

        setExecutionTestId(result.testId);
        setExecutionTestType(responseTestType);
        setActiveTab("report");

        if (responseTestType === "performance") {
          const resolvedRunId: string = result.runId || result.testId;
          setPerformanceRunId(resolvedRunId);
          setCurrentRunId(resolvedRunId); // Store for cancellation
          const fallbackLocation =
            (result.location as PerformanceLocation) ||
            options?.location ||
            ("global" as PerformanceLocation);
          setPerformanceLocation(fallbackLocation);
          setTestCase((prev) => ({
            ...prev,
            location: fallbackLocation,
          }));
          setIsReportLoading(false);
          setTestExecutionStatus("none");

          return;
        }

        if (!result.reportUrl) {
          throw new Error("Missing report URL from test execution response");
        }

        setReportUrl(result.reportUrl);
        setCurrentRunId(result.runId || result.testId); // Store runId for cancellation (runId is the database/queue ID)

        const eventSource = new EventSource(
          `/api/test-status/events/${result.testId}`
        );
        let eventSourceClosed = false;

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data?.status) {
              const normalizedStatus =
                typeof data.status === "string"
                  ? data.status.toLowerCase()
                  : "running";
              const derivedStatus =
                typeof data.derivedStatus === "string"
                  ? data.derivedStatus.toLowerCase()
                  : normalizedStatus;
              const reportStatus =
                typeof data.reportStatus === "string"
                  ? data.reportStatus.toLowerCase()
                  : null;

              // Cancellations are now stored as 'error' status with cancellation info in errorDetails
              // Check both explicit error field and errorDetails for cancellation keywords
              const errorDetailsCheck = typeof data.errorDetails === 'string'
                ? data.errorDetails.toLowerCase()
                : '';
              const isCancelled =
                errorDetailsCheck.includes('cancellation') ||
                errorDetailsCheck.includes('cancelled');

              const isTerminalStatus =
                normalizedStatus === "completed" ||
                normalizedStatus === "passed" ||
                normalizedStatus === "failed" ||
                normalizedStatus === "error" ||
                derivedStatus === "completed" ||
                derivedStatus === "passed" ||
                derivedStatus === "failed" ||
                derivedStatus === "error" ||
                reportStatus === "completed" ||
                reportStatus === "failed" ||
                reportStatus === "error";

              if (isTerminalStatus) {
                setIsRunning(false);
                setCurrentRunId(null);
                setIsReportLoading(false);

                // Only treat as passed when we explicitly see a passed/ok status
                const testPassed =
                  derivedStatus === "passed" || derivedStatus === "success";
                setTestExecutionStatus(testPassed ? "passed" : "failed");
                if (testPassed) {
                  setLastExecutedScript(editorContent);
                }

                eventSource.close();
                eventSourceClosed = true;

                if (result.testId) {
                  const apiUrl = `/api/test-results/${result.testId
                    }/report/index.html?t=${Date.now()}&forceIframe=true`;
                  setReportUrl(apiUrl);
                  setActiveTab("report");

                  if (!completedTestIds.includes(result.testId)) {
                    setCompletedTestIds((prev) => [...prev, result.testId]);
                  }
                } else {
                  console.error(
                    "Cannot construct report URL: testId from initial API call is missing."
                  );
                  toast.error("Error displaying report", {
                    description:
                      "Could not determine the test ID to load the report.",
                  });
                }

                // Show appropriate toast based on status (skip cancelled - already shown by handleCancelRun)
                if (!isCancelled) {
                  const isSuccess = testPassed;
                  toast[isSuccess ? "success" : "error"](
                    isSuccess
                      ? "Script execution passed"
                      : "Script execution failed",
                    {
                      description: isSuccess
                        ? "All checks completed successfully."
                        : "Test execution completed with failures or errors. Please review the report before saving.",
                      duration: 10000,
                    }
                  );
                }
              }
            }
          } catch (e) {
            console.error(
              "Error parsing SSE event:",
              e,
              "Raw event data:",
              event.data
            );
          }
        };

        eventSource.onerror = (e) => {
          console.error("SSE connection error:", e);
          setIsRunning(false);
          setCurrentRunId(null);
          setIsReportLoading(false);

          // Mark test as failed when SSE connection fails
          setTestExecutionStatus("failed");

          toast.error("Script execution error", {
            description:
              "Connection to test status updates was lost. The test may still be running in the background.",
            duration: 5000,
          });

          if (!eventSourceClosed) {
            eventSource.close();
            eventSourceClosed = true;

            if (result.testId) {
              const apiUrl = `/api/test-results/${result.testId
                }/report/index.html?t=${Date.now()}&forceIframe=true`;
              setReportUrl(apiUrl);
              setActiveTab("report");
            } else {
              console.error(
                "SSE error fallback: Cannot construct report URL: testId from initial API call is missing."
              );
            }
          }
        };
      } else {
        setIsRunning(false);
        setCurrentRunId(null);
        setIsReportLoading(false);

        // Mark test as failed when execution fails
        setTestExecutionStatus("failed");

        if (result.error) {
          console.error("Script execution error:", result.error);

          if (result.isValidationError) {
            setValidationError(result.validationError);
            setIsValid(false);
            setHasValidated(true);
            toast.error("Script Validation Failed", {
              description:
                result.validationError ||
                "Please fix validation errors before running the test.",
              duration: 5000,
            });
          } else {
            toast.error("Script Execution Failed", {
              description:
                result.error ||
                "The test encountered an error during execution. Please check your test script and try again.",
              duration: 5000,
            });
          }
        } else {
          console.error("API response missing required fields:", result);
          toast.error("Script Execution Issue", {
            description: "Could not retrieve test report URL.",
            duration: 5000,
          });
        }
      }
    } catch (error) {
      console.error("Error running script:", error);
      setIsRunning(false);
      setCurrentRunId(null);
      setIsReportLoading(false);

      // Mark test as failed when exception occurs
      setTestExecutionStatus("failed");

      toast.error("Error running script", {
        description:
          error instanceof Error
            ? error.message
            : "Unknown error occurred during test execution",
        duration: 5000,
      });
    }
  };

  const runTest = async () => {
    if (!userCanRunTests) {
      toast.error("Insufficient permissions", {
        description:
          "You don't have permission to run tests. Contact your organization admin for access.",
      });
      return;
    }

    if (isRunning) {
      toast.warning("A script is already running", {
        description:
          "Please wait for the current script to complete, or cancel it before running a new script.",
      });
      return;
    }

    const validationResult = await validateScript(editorContent);
    setValidationError(validationResult.error || null);
    setValidationLine(validationResult.line);
    setValidationColumn(validationResult.column);
    setValidationErrorType(validationResult.errorType);
    setIsValid(validationResult.valid);
    setHasValidated(true);

    if (validationResult.valid) {
      setLastValidatedScript(editorContent);
    }

    if (!validationResult.valid) {
      toast.error("Script validation failed", {
        description:
          validationResult.error ||
          "Please fix validation errors before running the test.",
        duration: 5000,
      });
      return;
    }

    if (isPerformanceMode) {
      setLocationDialogOpen(true);
      return;
    }

    await executeQueuedTest();
  };

  const handleLocationSelect = async (location: PerformanceLocation) => {
    setPerformanceLocation(location);
    setTestCase((prev) => ({
      ...prev,
      location,
    }));
    await executeQueuedTest({ location });
  };

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleCancelRun = async () => {
    if (!currentRunId) {
      toast.error("Cannot cancel", {
        description: "No active run to cancel",
      });
      return;
    }

    setIsCancelling(true);
    setShowCancelConfirm(false);

    try {
      const response = await fetch(`/api/runs/${currentRunId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        toast.error("Failed to cancel run", {
          description: errorData.error || "Unknown error occurred",
        });
        setIsCancelling(false);
        return;
      }

      const data = await response.json();

      if (data.success) {
        toast.success("Run cancelled", {
          description: "The execution has been cancelled successfully",
        });

        // Reset state
        setIsRunning(false);
        setIsReportLoading(false);
        setTestExecutionStatus("failed");

        // Update report URL to trigger refresh with cancellation info
        // The ReportViewer will detect the cancellation from the API response
        // Update report URL to trigger refresh with cancellation info
        // The ReportViewer will detect the cancellation from the API response
        if (currentRunId) {
          const apiUrl = `/api/test-results/${currentRunId}/report/index.html?t=${Date.now()}&forceIframe=true`;
          setReportUrl(apiUrl);
          setActiveTab("report");
        }

        setCurrentRunId(null);
        // Trigger global UI refresh immediately
        notifyExecutionsChanged();
      } else {
        toast.error("Failed to cancel run", {
          description: data.message || "Unknown error occurred",
        });
      }
    } catch (error) {
      console.error("[Playground] Error cancelling run:", error);
      toast.error("Error cancelling run", {
        description: error instanceof Error ? error.message : "Network error",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  // AI Fix handlers
  const handleAIFixStreamingStart = () => {
    setIsStreamingAIFix(true);
    setStreamingFixContent("");
    setAIFixedScript("");
    setAIExplanation("");
    setShowAIDiff(true); // Show diff viewer immediately when streaming starts
  };

  const handleAIFixStreamingUpdate = (content: string) => {
    setStreamingFixContent(extractCodeFromResponse(content));
  };

  const handleAIFixStreamingEnd = () => {
    console.log(
      "[Playground] handleAIFixStreamingEnd called - setting isStreamingAIFix to false"
    );
    setIsStreamingAIFix(false);
  };

  const handleAIFixSuccess = (fixedScript: string, explanation: string) => {
    setIsStreamingAIFix(false);
    setAIFixedScript(extractCodeFromResponse(fixedScript));
    setAIExplanation(explanation);
    setStreamingFixContent("");
    setShowAIDiff(true);
  };

  const handleShowGuidance = (
    _reason: string,
    guidance: string,
    _errorAnalysis?: { totalErrors?: number; categories?: string[] }
  ) => {
    // Use errorAnalysis for debugging purposes
    if (_errorAnalysis && process.env.NODE_ENV === "development") {
    }
    setGuidanceMessage(guidance);
    setShowGuidanceModal(true);
  };

  const handleAIAnalyzing = (analyzing: boolean) => {
    setIsAIAnalyzing(analyzing);
  };

  const handleAcceptAIFix = (acceptedScript: string) => {
    setEditorContent(acceptedScript);
    setTestCase((prev) => ({ ...prev, script: acceptedScript }));
    setShowAIDiff(false);

    // Reset validation state since script has changed
    setHasValidated(false);
    setIsValid(false);
    setValidationError(null);

    // Reset test execution status since script changed
    setTestExecutionStatus("none");

    toast.success("AI fix applied", {
      description:
        "Script updated with AI-generated fixes. Please validate and test.",
    });
  };

  const handleRejectAIFix = () => {
    setShowAIDiff(false);
    toast.info("AI fix discarded", {
      description: "Original script remains unchanged.",
    });
  };

  const handleCloseDiffViewer = () => {
    setShowAIDiff(false);
  };

  const handleCloseGuidanceModal = () => {
    setShowGuidanceModal(false);
  };

  // AI Create handlers
  const handleAICreateStreamingStart = () => {
    setIsStreamingAICreate(true);
    setStreamingCreateContent("");
    setAIGeneratedScript("");
    setAICreateExplanation("");
    setShowAICreateDiff(true); // Show diff viewer immediately when streaming starts
  };

  const handleAICreateStreamingUpdate = (content: string) => {
    setStreamingCreateContent(extractCodeFromResponse(content));
  };

  const handleAICreateStreamingEnd = () => {
    setIsStreamingAICreate(false);
  };

  const handleAICreateSuccess = (
    generatedScript: string,
    explanation: string
  ) => {
    setIsStreamingAICreate(false);
    setAIGeneratedScript(extractCodeFromResponse(generatedScript));
    setAICreateExplanation(explanation);
    setStreamingCreateContent("");
    setShowAICreateDiff(true);
  };

  const handleAICreating = (creating: boolean) => {
    setIsAICreating(creating);
  };

  const handleAcceptAICreate = (acceptedScript: string) => {
    setEditorContent(acceptedScript);
    setTestCase((prev) => ({ ...prev, script: acceptedScript }));
    setShowAICreateDiff(false);

    // Reset validation state since script has changed
    setHasValidated(false);
    setIsValid(false);
    setValidationError(null);

    // Reset test execution status since script changed
    setTestExecutionStatus("none");

    toast.success("AI-generated code applied", {
      description: "New script applied to editor. Please validate and test.",
    });
  };

  const handleRejectAICreate = () => {
    setShowAICreateDiff(false);
    toast.info("AI-generated code discarded", {
      description: "Original script remains unchanged.",
    });
  };

  const handleCloseAICreateViewer = () => {
    setShowAICreateDiff(false);
  };

  return (
    <div className="h-full">
      <div className="h-full">
        <div className="md:hidden">{/* Mobile view */}</div>
        <div className="hidden flex-col flex-1 md:flex p-4  h-[calc(100vh-5rem)]">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={70} minSize={30}>
              <div className="flex h-full flex-col border rounded-tl-lg rounded-bl-lg">
                <div className="flex items-center justify-between border-b bg-card p-4 py-2 rounded-tl-lg">
                  <div className="flex items-center gap-8">
                    {/* Playground */}
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList className="grid w-[400px] grid-cols-2">
                        <TabsTrigger
                          value="editor"
                          className="flex items-center justify-center gap-2"
                        >
                          <svg
                            className="h-5 w-5 flex-shrink-0"
                            xmlns="http://www.w3.org/2000/svg"
                            x="0px"
                            y="0px"
                            width="96"
                            height="96"
                            viewBox="0 0 48 48"
                          >
                            <path fill="#ffd600" d="M6,42V6h36v36H6z"></path>
                            <path
                              fill="#000001"
                              d="M29.538 32.947c.692 1.124 1.444 2.201 3.037 2.201 1.338 0 2.04-.665 2.04-1.585 0-1.101-.726-1.492-2.198-2.133l-.807-.344c-2.329-.988-3.878-2.226-3.878-4.841 0-2.41 1.845-4.244 4.728-4.244 2.053 0 3.528.711 4.592 2.573l-2.514 1.607c-.553-.988-1.151-1.377-2.078-1.377-.946 0-1.545.597-1.545 1.377 0 .964.6 1.354 1.985 1.951l.807.344C36.452 29.645 38 30.839 38 33.523 38 36.415 35.716 38 32.65 38c-2.999 0-4.702-1.505-5.65-3.368L29.538 32.947zM17.952 33.029c.506.906 1.275 1.603 2.381 1.603 1.058 0 1.667-.418 1.667-2.043V22h3.333v11.101c0 3.367-1.953 4.899-4.805 4.899-2.577 0-4.437-1.746-5.195-3.368L17.952 33.029z"
                            ></path>
                          </svg>
                          <span>Editor</span>
                        </TabsTrigger>
                        <TabsTrigger
                          value="report"
                          className="flex items-center gap-2"
                        >
                          {isPerformanceMode ? (
                            <K6Logo width={20} height={20} />
                          ) : (
                            <PlaywrightLogo className="h-5 w-5" />
                          )}
                          <span>Report</span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>

                    {/* Templates Button - next to Report tab but outside tabs */}
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={() => setTemplateDialogOpen(true)}
                        variant="outline"
                        size="sm"
                        disabled={isRunning}
                        className="gap-2 h-9 px-4"
                      >
                        <Code2 className="h-4 w-4" />
                        <span>Templates</span>
                      </Button>
                    </div>

                    {/* Runtime Libraries Info */}
                    <div className="-ml-4">
                      <RuntimeInfoPopover testType={testCase.type} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      {/* Run Button - always visible */}
                      <Button
                        onClick={isRunning ? undefined : runTest}
                        disabled={
                          isRunning ||
                          isValidating ||
                          isAIAnalyzing ||
                          isAICreating ||
                          !userCanRunTests
                        }
                        className="flex items-center gap-2 bg-[hsl(221.2,83.2%,53.3%)] text-white hover:bg-[hsl(221.2,83.2%,48%)]"
                        size="sm"
                        title={
                          isRunning
                            ? "Test is currently running"
                            : !userCanRunTests
                              ? "Insufficient permissions to run tests"
                              : "Run test"
                        }
                      >
                        {isValidating ? (
                          <>
                            <Loader2Icon className="h-4 w-4 animate-spin" />
                            <span className="mr-2">Validating...</span>
                          </>
                        ) : isRunning ? (
                          <>
                            <Loader2Icon className="h-4 w-4 animate-spin" />
                            <span className="mr-2">Running...</span>
                          </>
                        ) : (
                          <>
                            <ZapIcon className="h-4 w-4" />
                            <span className="mr-2">Run</span>
                          </>
                        )}
                      </Button>

                      {/* Cancel Button - overlaid on top right when running */}
                      {isRunning && !isCancelling && userCanRunTests && (
                        <TooltipProvider>
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <Button
                                onClick={handleCancelClick}
                                size="sm"
                                variant="ghost"
                                className="absolute -top-1.5 -right-1.5 h-5 w-5 p-0 rounded-full bg-red-500 hover:bg-red-600 shadow-md transition-colors"
                              >
                                <X className="h-3 w-3 text-white" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p>Cancel run</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>

                    {/* Cancel Confirmation Dialog */}
                    <AlertDialog
                      open={showCancelConfirm}
                      onOpenChange={setShowCancelConfirm}
                    >
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Cancel Execution?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to cancel this test execution?
                            This action cannot be undone and the run will be
                            marked as cancelled.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>
                            Continue Running
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleCancelRun}
                            className="bg-red-500 hover:bg-red-600"
                          >
                            Cancel Execution
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden rounded-bl-lg">
                  <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="h-full"
                  >
                    <TabsContent
                      value="editor"
                      className="h-full border-0 p-0 mt-0 relative"
                    >
                      <div className="h-full flex flex-col">
                        {/* Validation Error Display */}
                        {validationError && (
                          <div className="z-10">
                            <ValidationError
                              error={validationError}
                              line={validationLine}
                              column={validationColumn}
                              errorType={validationErrorType}
                              onDismiss={() => {
                                resetValidationState();
                                setLastValidatedScript(""); // Clear last validated script on dismiss
                                resetTestExecutionState(); // Also clear test execution state
                              }}
                            />
                          </div>
                        )}

                        {/* Browser Recording Instructions - shown for all new browser tests */}
                        {testCase.type === "browser" && !testId && showRecordingBanner && (
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-red-500/20 bg-red-500/5">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-500/10">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                              </div>
                              <div>
                                <span className="text-sm font-medium text-red-400">Record Browser Test</span>
                                <span className="text-sm text-muted-foreground ml-2">
                                  Use Playwright recorder to capture interactions, then paste the code below.
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => window.open("https://chromewebstore.google.com/detail/playwright-crx/jambeljnbnfbkcpnoiaedcabbgmnnlcd", "_blank")}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Get Recorder
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowRecordingBanner(false)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}

                        <div className="flex-1">
                          <CodeEditor
                            value={editorContent}
                            onChange={(value) => {
                              const newValue = value || "";

                              // CRITICAL: Only reset validation/execution state if content ACTUALLY changed
                              // Monaco editor fires onChange during re-renders (e.g., when tags update)
                              // even when the content is identical. This prevents spurious resets.
                              if (newValue !== lastEditorContentRef.current) {
                                // Content has genuinely changed - update state
                                setEditorContent(newValue);
                                lastEditorContentRef.current = newValue;

                                // Clear validation and test execution state when script changes
                                if (hasValidated) {
                                  resetValidationState();
                                }
                                if (testExecutionStatus !== "none") {
                                  resetTestExecutionState();
                                }
                              }
                            }}
                            ref={editorRef}
                          />
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent
                      value="report"
                      className="h-full border-0 p-0 mt-0"
                    >
                      {executionTestType === "performance" &&
                        performanceRunId ? (
                        <PerformanceTestReport
                          runId={performanceRunId}
                          onStatusChange={(status) => {
                            if (status !== "running") {
                              setIsRunning(false);
                              // For K6 performance tests:
                              // - "passed" = script ran && thresholds passed && checks passed
                              // - "failed" = script ran but thresholds/checks failed (report generated)
                              // - "error" = script failed to execute (syntax error, timeout, etc.)
                              // 
                              // For SAVING purposes, we consider both "passed" and "failed" as 
                              // successful execution because the script RAN to completion and
                              // generated a report. K6 tests can run for up to an hour, so we
                              // must allow saving even if thresholds failed to avoid wasting
                              // user resources.
                              // Only "error" should block saving (indicates script didn't execute).

                              // Use ref to get the latest editor content, avoiding stale closure
                              // issues during long-running k6 tests
                              const currentScript = lastEditorContentRef.current;

                              if (status === "passed" || status === "failed") {
                                // Script executed and generated report - allow saving
                                setTestExecutionStatus("passed");
                                setLastExecutedScript(currentScript);
                              } else if (status === "error") {
                                // Script failed to execute - don't allow saving
                                setTestExecutionStatus("failed");
                              }
                              // Note: Cancellations are stored as "error" status with cancellation
                              // info in errorDetails. They're handled in the error case above.
                            }
                          }}
                        />
                      ) : (
                        <ReportViewer
                          reportUrl={reportUrl}
                          isRunning={isRunning || isReportLoading}
                          containerClassName="h-full w-full relative border-1 rounded-bl-lg"
                          iframeClassName="h-full w-full rounded-bl-lg"
                        />
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel
              defaultSize={30}
              minSize={20}
              className="rounded-br-lg rounded-tr-lg"
            >
              <div className="flex h-full flex-col border rounded-tr-lg rounded-br-lg bg-card">
                <div className="flex items-center justify-between border-b bg-card px-4 py-3 rounded-tr-lg">
                  <div className="flex items-center">
                    <Text className="h-4 w-4 mr-2" />
                    <h3 className="text-sm font-medium mt-1">Test Details</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* AI Fix Button - reserved space to prevent layout shift */}
                    <div className="min-w-[80px]">
                      <AIFixButton
                        testId={executionTestId || ""}
                        failedScript={editorContent}
                        testType={testCase.type || "browser"}
                        isVisible={aiFixVisible}
                        disabled={isRunning || isValidating || isAIAnalyzing}
                        onAIFixSuccess={handleAIFixSuccess}
                        onShowGuidance={handleShowGuidance}
                        onAnalyzing={handleAIAnalyzing}
                        onStreamingStart={handleAIFixStreamingStart}
                        onStreamingUpdate={handleAIFixStreamingUpdate}
                        onStreamingEnd={handleAIFixStreamingEnd}
                      />
                    </div>
                    {/* AI Create Button placed next to Test Details actions; hidden when Fix is available */}
                    {!aiFixVisible && (
                      <AICreateButton
                        currentScript={editorContent}
                        testType={testCase.type || "browser"}
                        isVisible={
                          !isAIAnalyzing && !isAICreating && userCanRunTests
                        }
                        disabled={isRunning || isValidating}
                        onAICreateSuccess={handleAICreateSuccess}
                        onAnalyzing={handleAICreating}
                        onStreamingStart={handleAICreateStreamingStart}
                        onStreamingUpdate={handleAICreateStreamingUpdate}
                        onStreamingEnd={handleAICreateStreamingEnd}
                        initialPrompt={aiPrompt}
                        initialIsOpen={aiAutoOpen}
                        isLoadingPrompt={isLoadingPrompt}
                      />
                    )}
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="space-y-3 p-4">
                    <TestForm
                      testCase={testCase}
                      setTestCase={setTestCase}
                      editorContent={editorContent}
                      isRunning={isRunning}
                      setInitialEditorContent={setInitialEditorContent}
                      initialFormValues={initialFormValues}
                      initialEditorContent={initialEditorContent}
                      testId={testId}
                      errors={errors}
                      validateForm={validateForm}
                      isCurrentScriptValidated={isCurrentScriptValidated}
                      isCurrentScriptReadyToSave={isCurrentScriptReadyToSave}
                      testExecutionStatus={testExecutionStatus}
                      userRole={currentProject?.userRole}
                      userId={currentUserId}
                      isPerformanceMode={isPerformanceMode}
                      performanceLocation={performanceLocation}
                      onPerformanceLocationChange={(location) => {
                        setPerformanceLocation(location);
                        setTestCase((prev) => ({
                          ...prev,
                          location,
                        }));
                      }}
                      linkedRequirement={linkedRequirement}
                    />
                  </div>
                </ScrollArea>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        {loading && (
          <div className="fixed top-0 left-0 right-0 bottom-0 bg-[#1e1e1e] flex items-center justify-center">
            <Loader2Icon className="h-8 w-8 animate-spin" />
          </div>
        )}
      </div>

      <LocationSelectionDialog
        open={locationDialogOpen && isPerformanceMode}
        onOpenChange={(open) => {
          setLocationDialogOpen(open);
        }}
        onSelect={handleLocationSelect}
        defaultLocation={performanceLocation}
      />

      <TemplateDialog
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        testType={testCase.type}
        onApply={(code) => {
          setEditorContent(code);
          // Clear validation and test execution state when new template is applied
          if (hasValidated) {
            resetValidationState();
          }
          if (testExecutionStatus !== "none") {
            resetTestExecutionState();
          }
          toast.success("Template applied successfully");
        }}
      />

      {/* AI Diff Viewer Modal */}
      <AIDiffViewer
        originalScript={editorContent}
        fixedScript={aiFixedScript}
        explanation={aiExplanation}
        isVisible={showAIDiff}
        onAccept={handleAcceptAIFix}
        onReject={handleRejectAIFix}
        onClose={handleCloseDiffViewer}
        isStreaming={isStreamingAIFix}
        streamingContent={streamingFixContent}
      />

      {/* AI Create Viewer Modal */}
      <AICreateViewer
        currentScript={editorContent}
        generatedScript={aiGeneratedScript}
        explanation={aiCreateExplanation}
        isVisible={showAICreateDiff}
        onAccept={handleAcceptAICreate}
        onReject={handleRejectAICreate}
        onClose={handleCloseAICreateViewer}
        isStreaming={isStreamingAICreate}
        streamingContent={streamingCreateContent}
      />

      {/* Guidance Modal */}
      <GuidanceModal
        isVisible={showGuidanceModal}
        guidance={guidanceMessage}
        onClose={handleCloseGuidanceModal}
      />
    </div>
  );
};

export default Playground;
