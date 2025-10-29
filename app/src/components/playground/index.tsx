"use client";
import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CodeEditor } from "./code-editor";
import { TestForm } from "./test-form";
import { LoadingOverlay } from "./loading-overlay";
import { ValidationError } from "./validation-error";
import { TestPriority, TestType } from "@/db/schema";
import { Loader2Icon, ZapIcon, Text } from "lucide-react";
import * as z from "zod";
import type { editor } from "monaco-editor";
import type { ScriptType } from "@/lib/script-service";
import { ReportViewer } from "@/components/shared/report-viewer";
import { useProjectContext } from "@/hooks/use-project-context";
import { canRunTests } from "@/lib/rbac/client-permissions";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import RuntimeInfoPopover from "./runtime-info-popover";
import { AIFixButton } from "./ai-fix-button";
import { AIDiffViewer } from "./ai-diff-viewer";
import { GuidanceModal } from "./guidance-modal";
import { PlaywrightLogo } from "../logo/playwright-logo";

// Define our own TestCaseFormData interface
interface TestCaseFormData {
  title: string;
  description: string | null;
  priority: TestPriority;
  type: TestType;
  script?: string;
  updatedAt?: string | null;
  createdAt?: string | null;
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
  };
  initialTestId?: string;
}

const Playground: React.FC<PlaygroundProps> = ({
  initialTestData,
  initialTestId,
}) => {
  // Permission checking
  const { currentProject } = useProjectContext();
  const userCanRunTests = currentProject?.userRole
    ? canRunTests(normalizeRole(currentProject.userRole))
    : false;
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(
    undefined
  );

  // Fetch current user ID for permissions
  useEffect(() => {
    const fetchUserId = async () => {
      try {
        const response = await fetch("/api/auth/user");
        if (response.ok) {
          const userData = await response.json();
          setCurrentUserId(userData.user?.id);
        }
      } catch (error) {
        console.error("Error fetching user ID:", error);
      }
    };
    fetchUserId();
  }, []);

  const [activeTab, setActiveTab] = useState<string>("editor");
  const [isRunning, setIsRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  // Only set testId from initialTestId if we're on a specific test page
  // Always ensure testId is null when on the main playground page
  const [testId, setTestId] = useState<string | null>(initialTestId || null);
  // Separate state for tracking the current test execution ID (for AI Fix functionality)
  const [executionTestId, setExecutionTestId] = useState<string | null>(null);
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
          priority: initialTestData.priority,
          type: initialTestData.type,
          updatedAt: initialTestData.updatedAt || undefined,
          createdAt: initialTestData.createdAt || undefined,
        }
      : {}
  );
  const [testCase, setTestCase] = useState<TestCaseFormData>({
    title: initialTestData?.title || "",
    description: initialTestData?.description || "",
    priority: initialTestData?.priority || ("medium" as TestPriority),
    type: initialTestData?.type || ("browser" as TestType),
    script: initialTestData?.script || "",
    updatedAt: initialTestData?.updatedAt || undefined,
    createdAt: initialTestData?.createdAt || undefined,
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
  >("none"); // Track if last test run passed or failed
  const [lastExecutedScript, setLastExecutedScript] = useState<string>(""); // Track last executed script
  const [isAIAnalyzing, setIsAIAnalyzing] = useState(false); // Track AI Fix analyzing state

  // AI Fix functionality state
  const [showAIDiff, setShowAIDiff] = useState(false);
  const [aiFixedScript, setAIFixedScript] = useState<string>("");
  const [aiExplanation, setAIExplanation] = useState<string>("");
  const [showGuidanceModal, setShowGuidanceModal] = useState(false);
  const [guidanceMessage, setGuidanceMessage] = useState<string>("");

  // Derived state: is current script validated and passed?
  const isCurrentScriptValidated =
    hasValidated && isValid && editorContent === lastValidatedScript;
  const isCurrentScriptExecutedSuccessfully =
    testExecutionStatus === "passed" && editorContent === lastExecutedScript;
  const isCurrentScriptReadyToSave =
    isCurrentScriptValidated && isCurrentScriptExecutedSuccessfully;

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
    setTestExecutionStatus("none");
    setExecutionTestId(null); // Clear execution test ID for new script
    // Don't reset lastExecutedScript here - only when test passes
  };

  // Editor reference
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const searchParams = useSearchParams();

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

    // Set pageLoading to false after a short delay to ensure UI is ready
    const timer = setTimeout(() => {
      setPageLoading(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  // Initialize validation state for existing test data
  useEffect(() => {
    if (initialTestData && initialTestData.script) {
      // For existing tests, consider them as needing revalidation for security
      resetValidationState();
      setLastValidatedScript(""); // Force revalidation of existing scripts
    }
  }, [initialTestData]);

  // Load test data if testId is provided
  useEffect(() => {
    if (initialTestId) {
      loadTestById(initialTestId);
    }
  }, [initialTestId]);

  // Function to load a test by ID
  const loadTestById = async (id: string) => {
    try {
      setLoading(true);

      // Fetch the test data from API
      const response = await fetch(`/api/tests/${id}`);
      const result = await response.json();

      if (response.ok && result) {
        // Update the test case data
        setTestCase({
          title: result.title,
          description: result.description,
          priority: result.priority as TestPriority,
          type: result.type as TestType,
          updatedAt: result.updatedAt || null,
          createdAt: result.createdAt || null,
        });

        // Update the editor content
        setEditorContent(result.script);
        setInitialEditorContent(result.script);

        // Update the form values
        setInitialFormValues({
          title: result.title,
          description: result.description,
          priority: result.priority as TestPriority,
          type: result.type as TestType,
          updatedAt: result.updatedAt || null,
          createdAt: result.createdAt || null,
        });

        // Set the test ID
        setTestId(id);
      } else {
        console.error("Failed to load test:", result.error);
        toast.error("Error loading test", {
          description: "Failed to load test details. Please try again later.",
        });
      }
    } catch (error) {
      console.error("Error loading test:", error);
      toast.error("Error", {
        description: "Failed to load test details. Please try again later.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Monitor URL search params changes and potentially load scripts/set type
  useEffect(() => {
    const scriptTypeParam = searchParams.get("scriptType") as TestType | null;

    if (!initialTestId) {
      setTestId(null);

      const defaultType = "browser" as TestType;
      const typeToSet =
        scriptTypeParam &&
        ["browser", "api", "custom", "database"].includes(scriptTypeParam)
          ? scriptTypeParam
          : defaultType;

      setTestCase((prev) => ({ ...prev, type: typeToSet }));

      const loadScriptForType = async () => {
        if (typeToSet) {
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
  }, [searchParams, initialTestId]);

  // Handle initialTestData when provided from server-side
  useEffect(() => {
    if (initialTestData) {
      // If we have initial test data from the server, use it
      // Update the initial form values to match the loaded test
      setInitialFormValues({
        title: initialTestData.title,
        description: initialTestData.description || undefined,
        priority: initialTestData.priority,
        type: initialTestData.type,
        updatedAt: initialTestData.updatedAt || undefined,
        createdAt: initialTestData.createdAt || undefined,
      });
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

      const newErrors: Record<string, string> = {};

      // Validate title
      if (!validationData.title || validationData.title.trim() === "") {
        newErrors.title = "Title is required";
      }

      // Validate description - make it mandatory
      if (
        !validationData.description ||
        validationData.description.trim() === ""
      ) {
        newErrors.description = "Description is required";
      }

      // Validate script
      if (!validationData.script || validationData.script.trim() === "") {
        newErrors.script = "Test script is required";
      }

      // Validate type - explicit check for missing type without comparing to empty string
      if (!validationData.type) {
        newErrors.type = "Test type is required";
      }

      // Validate priority - explicit check for missing priority without comparing to empty string
      if (!validationData.priority) {
        newErrors.priority = "Priority is required";
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

    // Validate the script content
    const validationResult = await validateScript(editorContent);
    setValidationError(validationResult.error || null);
    setValidationLine(validationResult.line);
    setValidationColumn(validationResult.column);
    setValidationErrorType(validationResult.errorType);
    setIsValid(validationResult.valid);
    setHasValidated(true);

    if (validationResult.valid) {
      setLastValidatedScript(editorContent); // Update last validated script on success
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

    setIsRunning(true);

    try {
      // Execute the test by sending the current script content to the API
      const res = await fetch(`/api/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: testId,
          script: editorContent,
        }),
      });

      // Parse the response
      const result = await res.json();

      // If we successfully started a test and got back the needed test info
      if (res.ok && result.testId && result.reportUrl) {
        // No need for success toast here - the loading toast is already shown
        // We'll keep the loading toast until we get the final status update

        // Don't set testId for playground executions - only for editing existing tests
        // But do set the execution test ID for AI Fix functionality
        setExecutionTestId(result.testId);

        // Set the report URL to display the test results
        setReportUrl(result.reportUrl);

        // Switch to the report tab
        setActiveTab("report");

        // Set up Server-Sent Events (SSE) to get real-time status updates
        const eventSource = new EventSource(
          `/api/test-status/events/${result.testId}`
        );
        let eventSourceClosed = false;

        // Handle status updates from the SSE endpoint
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data) {
              // Check if data includes status field
              if (data.status) {
                // Normalize status value for consistency
                const normalizedStatus = data.status.toLowerCase();

                // Handle status - this could update a state variable to show in UI
                if (
                  normalizedStatus === "completed" ||
                  normalizedStatus === "passed" ||
                  normalizedStatus === "failed" ||
                  normalizedStatus === "error"
                ) {
                  // Test is done, update the UI
                  setIsRunning(false);
                  setIsReportLoading(false);

                  // Update test execution status based on result
                  const testPassed =
                    normalizedStatus === "completed" ||
                    normalizedStatus === "passed";
                  setTestExecutionStatus(testPassed ? "passed" : "failed");
                  if (testPassed) {
                    setLastExecutedScript(editorContent); // Mark this script as successfully executed
                  }

                  // Close the SSE connection
                  eventSource.close();
                  eventSourceClosed = true;

                  // Construct the relative API report URL, don't use the direct S3 URL from data
                  if (result.testId) {
                    // Ensure we have the testId from the initial API call
                    const apiUrl = `/api/test-results/${
                      result.testId
                    }/report/index.html?t=${Date.now()}&forceIframe=true`;
                    setReportUrl(apiUrl); // Use the relative API path

                    // Always stay on report tab and ensure we're viewing the report
                    setActiveTab("report");

                    // Add test ID to the list of completed tests
                    if (
                      result.testId &&
                      !completedTestIds.includes(result.testId)
                    ) {
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

                  // Determine if it was a success or failure for the toast
                  const isSuccess =
                    normalizedStatus === "completed" ||
                    normalizedStatus === "passed";

                  // Show completion toast
                  toast[isSuccess ? "success" : "error"](
                    isSuccess
                      ? "Script execution passed"
                      : "Script execution failed",
                    {
                      description: isSuccess
                        ? "All checks completed successfully."
                        : "All checks did not complete successfully.",
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

        // Handle SSE errors
        eventSource.onerror = (e) => {
          console.error("SSE connection error:", e);
          // Fallback for SSE errors - just set not running
          setIsRunning(false);
          setIsReportLoading(false);

          // Show error toast
          toast.error("Script execution error", {
            description:
              "Connection to test status updates was lost. The test may still be running in the background.",
            duration: 5000,
          });

          if (!eventSourceClosed) {
            eventSource.close();
            eventSourceClosed = true;

            // Try to load the report anyway using the API path if testId is available
            if (result.testId) {
              const apiUrl = `/api/test-results/${
                result.testId
              }/report/index.html?t=${Date.now()}&forceIframe=true`;
              setReportUrl(apiUrl); // Use the relative API path
              setActiveTab("report");
            } else {
              console.error(
                "SSE error fallback: Cannot construct report URL: testId from initial API call is missing."
              );
            }
          }
        };
      } else {
        // If we didn't get a report URL or test ID, something went wrong
        setIsReportLoading(false);
        setIsRunning(false);

        // Check for errors first
        if (result.error) {
          console.error("Script execution error:", result.error);

          // Handle validation errors specially
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
            // Always show a user-friendly message regardless of the actual error
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
      toast.error("Error running script", {
        description: error instanceof Error ? error.message : "Unknown error",
        duration: 5000,
      });
      setIsRunning(false);
    }
  };

  // AI Fix handlers
  const handleAIFixSuccess = (fixedScript: string, explanation: string) => {
    setAIFixedScript(fixedScript);
    setAIExplanation(explanation);
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

  return (
    <>
      <LoadingOverlay isVisible={pageLoading} />
      <div
        className={
          pageLoading
            ? "opacity-0"
            : "opacity-100 transition-opacity duration-300"
        }
      >
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
                          {/* <FileTextIcon className="h-4 w-4" /> */}
                          <PlaywrightLogo className="h-5 w-5" />
                          <span>Report</span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>

                    {/* Runtime Libraries Info */}
                    <div className="-ml-4">
                      <RuntimeInfoPopover />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* AI Fix Button - reserved space to prevent layout shift */}
                    <div className="min-w-[80px]">
                      <AIFixButton
                        testId={executionTestId || ""}
                        failedScript={editorContent}
                        testType={testCase.type || "browser"}
                        isVisible={
                          // Always show when test execution is completely finished AND failed
                          testExecutionStatus === "failed" &&
                          !isRunning &&
                          !isValidating &&
                          !isReportLoading &&
                          userCanRunTests &&
                          !!executionTestId // Ensure we have an execution test ID
                        }
                        onAIFixSuccess={handleAIFixSuccess}
                        onShowGuidance={handleShowGuidance}
                        onAnalyzing={handleAIAnalyzing}
                      />
                    </div>

                    <Button
                      onClick={runTest}
                      disabled={
                        isRunning ||
                        isValidating ||
                        isAIAnalyzing ||
                        !userCanRunTests
                      }
                      className="flex items-center gap-2 bg-[hsl(221.2,83.2%,53.3%)] text-white hover:bg-[hsl(221.2,83.2%,48%)] "
                      size="sm"
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

                        <div className="flex-1">
                          <CodeEditor
                            value={editorContent}
                            onChange={(value) => {
                              setEditorContent(value || "");
                              // Clear validation and test execution state when content changes
                              if (hasValidated) {
                                resetValidationState();
                              }
                              if (testExecutionStatus !== "none") {
                                resetTestExecutionState();
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
                      <ReportViewer
                        reportUrl={reportUrl}
                        isRunning={isRunning || isReportLoading}
                        containerClassName="h-full w-full relative border-1 rounded-bl-lg"
                        iframeClassName="h-full w-full rounded-bl-lg"
                      />
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
                <div className="flex items-center justify-between border-b bg-card px-4 py-4 rounded-tr-lg">
                  <div className="flex items-center">
                    <Text className="h-4 w-4 mr-2" />
                    <h3 className="text-sm font-medium mt-1">Test Details</h3>
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

      {/* AI Diff Viewer Modal */}
      <AIDiffViewer
        originalScript={editorContent}
        fixedScript={aiFixedScript}
        explanation={aiExplanation}
        isVisible={showAIDiff}
        onAccept={handleAcceptAIFix}
        onReject={handleRejectAIFix}
        onClose={handleCloseDiffViewer}
      />

      {/* Guidance Modal */}
      <GuidanceModal
        isVisible={showGuidanceModal}
        guidance={guidanceMessage}
        onClose={handleCloseGuidanceModal}
      />
    </>
  );
};

export default Playground;
