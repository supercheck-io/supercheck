import React, { useState, useEffect, useCallback, useMemo } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";  // Ensure this is imported
import { getLinkedTestRequirement } from "@/actions/get-linked-requirement";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SaveIcon, Trash2, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { testsInsertSchema, TestPriority, TestType } from "@/db/schema";
import { saveTest } from "@/actions/save-test";
import { decodeTestScript } from "@/actions/save-test";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { TESTS_QUERY_KEY } from "@/hooks/use-tests";
import { REQUIREMENTS_QUERY_KEY } from "@/hooks/use-requirements";
import { useTags, useTestTags, useTagMutations, useSaveTestTags } from "@/hooks/use-tags";
import { normalizeRole } from "@/lib/rbac/role-normalizer";
import {
  canCreateTags,
  canDeleteTags,
  canDeleteTests,
} from "@/lib/rbac/client-permissions";
import { deleteTest } from "@/actions/delete-test";
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
import { TagSelector, type Tag } from "@/components/ui/tag-selector";
import { priorities, types } from "@/components/tests/data";
import { type PerformanceLocation } from "./performance-locations";


const PLAYWRIGHT_TYPE_OPTIONS = types.filter((t) => t.value !== "performance");
const PERFORMANCE_TYPE_OPTIONS = types.filter((t) => t.value === "performance");

// Using the testsInsertSchema from schema.ts with extensions for playground-specific fields
const testCaseSchema = testsInsertSchema
  .extend({
    title: z
      .string()
      .min(1, "Title is required")
      .max(100, "Title must be less than 100 characters"),
    description: z
      .string()
      .nullable()
      .transform((val) => (val === null ? "" : val)) // Convert null to empty string
      .pipe(
        z
          .string()
          .min(1, "Description is required")
          .max(1000, "Description must be less than 1000 characters")
      ),
    script: z.string().min(1, "Test script is required"),
    priority: z.enum(["low", "medium", "high"] as const, {
      required_error: "Priority is required",
      invalid_type_error: "Priority must be low, medium, or high",
    }),
    type: z.enum(
      ["browser", "api", "custom", "database", "performance"] as const,
      {
        required_error: "Test type is required",
        invalid_type_error:
          "Test type must be browser, api, custom, database, or performance",
      }
    ),
    location: z
      .enum(["us-east", "eu-central", "asia-pacific", "global"] as const)
      .optional()
      .nullable(),
    updatedAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  })
  .omit({ createdAt: true, updatedAt: true });

type TestCaseFormData = z.infer<typeof testCaseSchema> & {
  updatedAt?: string | null;
  createdAt?: string | null;
};

interface TestFormProps {
  testCase: {
    title: string;
    description: string | null;
    priority: TestPriority;
    type: TestType;
    script?: string;
    updatedAt?: string | null;
    createdAt?: string | null;
    location?: PerformanceLocation | null;
  };
  setTestCase: React.Dispatch<
    React.SetStateAction<{
      title: string;
      description: string | null;
      priority: TestPriority;
      type: TestType;
      script?: string;
      updatedAt?: string | null;
      createdAt?: string | null;
      location?: PerformanceLocation | null;
    }>
  >;
  errors: Record<string, string>;
  validateForm: () => boolean;
  editorContent: string;
  isRunning: boolean;
  setInitialEditorContent: (content: string) => void;
  initialFormValues: Partial<{
    title: string;
    description: string | null;
    priority: TestPriority;
    type: TestType;
    script?: string;
    updatedAt?: string | null;
    createdAt?: string | null;
    location?: PerformanceLocation | null;
  }>;
  initialEditorContent: string;
  testId?: string | null;
  isCurrentScriptValidated: boolean; // Strict validation control
  isCurrentScriptReadyToSave: boolean; // Both validated and test passed
  testExecutionStatus: "none" | "passed" | "failed"; // Test execution status
  userRole?: string; // User's role for permission checks
  userId?: string; // Current user ID for permission checks
  isPerformanceMode?: boolean;
  performanceLocation?: PerformanceLocation;
  onPerformanceLocationChange?: (location: PerformanceLocation) => void;
  linkedRequirement?: { id: string; title: string; externalUrl?: string | null } | null;
}

export function TestForm({
  testCase,
  setTestCase,
  errors,
  validateForm,
  editorContent,
  isRunning,
  setInitialEditorContent,
  initialFormValues,
  initialEditorContent: initialEditorContentProp,
  testId,
  isCurrentScriptValidated,
  isCurrentScriptReadyToSave,
  testExecutionStatus,
  userRole,
  userId,
  isPerformanceMode = false,
  performanceLocation,
  onPerformanceLocationChange,
  linkedRequirement: initialLinkedRequirement,
}: TestFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [formChanged, setFormChanged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const performanceMode = isPerformanceMode || testCase.type === "performance";

  // Linked Requirement State
  const [linkedReq, setLinkedReq] = useState<{ id: string; title: string; externalUrl?: string | null } | null>(initialLinkedRequirement || null);

  useEffect(() => {
    if (testId) {
      getLinkedTestRequirement(testId).then(req => {
        if (req) {
          setLinkedReq(req);
        }
      });
    }
  }, [testId]);


  // Tag management - use React Query hooks for efficient caching
  const { tags: availableTags, isLoading: isLoadingAvailableTags } = useTags();
  const { testTags: fetchedTestTags, isLoading: isLoadingTestTags } = useTestTags(testId ?? null);
  const { createTag: createTagMutation, deleteTag: deleteTagMutation } = useTagMutations();
  const saveTestTagsMutation = useSaveTestTags();

  // Permission checks
  const role = userRole ? normalizeRole(userRole) : null;
  const canUserCreateTags = role ? canCreateTags(role) : false;
  const canUserDeleteTags = role ? canDeleteTags(role) : false;
  const canUserDeleteTests = role ? canDeleteTests(role) : false;

  const availableTypes = performanceMode
    ? PERFORMANCE_TYPE_OPTIONS
    : PLAYWRIGHT_TYPE_OPTIONS;
  const typeSelectValue = performanceMode
    ? availableTypes[0]?.value ?? "performance"
    : testCase.type || "browser";

  useEffect(() => {
    if (performanceMode && testCase.type !== "performance") {
      setTestCase((prev) => ({
        ...prev,
        type: "performance",
      }));
    }
  }, [performanceMode, testCase.type, setTestCase]);

  useEffect(() => {
    if (!performanceMode) {
      return;
    }

    const resolvedLocation =
      performanceLocation ?? testCase.location ?? "global";

    if (testCase.location !== resolvedLocation) {
      setTestCase((prev) => ({
        ...prev,
        location: resolvedLocation,
      }));
    }
  }, [performanceMode, performanceLocation, testCase.location, setTestCase]);


  // Function to check if specific tag can be deleted by current user
  const canDeleteSpecificTag = (tag: Tag): boolean => {
    if (!canUserDeleteTags || !role) return false;

    // For PROJECT_EDITOR, check if they created the tag
    if (role.toString() === "project_editor") {
      return tag.createdByUserId === userId;
    }

    // For PROJECT_ADMIN, ORG_ADMIN, ORG_OWNER, SUPER_ADMIN - they can delete any tag
    return ["project_admin", "org_admin", "org_owner", "super_admin"].includes(
      role.toString()
    );
  };

  // Sync selected tags when test tags are fetched from React Query hook
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [initialTags, setInitialTags] = useState<Tag[]>([]);
  const isLoadingTags = isLoadingAvailableTags || isLoadingTestTags;

  // Track if we've initialized tags to prevent infinite loops
  const hasInitializedTagsRef = React.useRef(false);

  // Update selected/initial tags when test tags are loaded from React Query
  // Only run ONCE when fetchedTestTags first becomes available
  useEffect(() => {
    // Reset flag if testId changes
    if (!testId) {
      hasInitializedTagsRef.current = false;
      setSelectedTags([]);
      setInitialTags([]);
      return;
    }

    // Only initialize once when fetchedTestTags is available (even if empty array)
    // Using !== undefined to handle tests with zero tags properly
    if (!hasInitializedTagsRef.current && fetchedTestTags !== undefined) {
      hasInitializedTagsRef.current = true;
      setSelectedTags(fetchedTestTags);
      setInitialTags(fetchedTestTags);
    }
  }, [fetchedTestTags, testId]);

  // Handle tag creation - uses mutation hook with automatic cache invalidation
  const handleCreateTag = async (
    name: string,
    color?: string
  ): Promise<Tag> => {
    const newTag = await createTagMutation.mutateAsync({ name, color });
    return newTag;
  };

  // Handle tag deletion - uses mutation hook with automatic cache invalidation
  const handleDeleteTag = async (tagId: string): Promise<void> => {
    const result = await deleteTagMutation.mutateAsync(tagId);
    const deletedTagName = result.deletedTag?.name || "Tag";
    toast.success(`${deletedTagName} deleted successfully`);
  };

  // Handle tag changes
  const handleTagChange = (tags: Tag[]) => {
    setSelectedTags(tags);
  };

  // Save tags when form is submitted - uses mutation hook
  // Note: For new tests (no testId), tags should be saved after the test is created.
  // The testIdToSave parameter supports both existing and new tests.
  const saveTestTags = async (testIdToSave: string) => {
    // Skip if no test ID - tags will be saved when test is created
    if (!testIdToSave) {
      return;
    }
    try {
      await saveTestTagsMutation.mutateAsync({
        testId: testIdToSave,
        tagIds: selectedTags.map((tag) => tag.id),
      });
    } catch (error) {
      console.error("Error saving test tags:", error);
    }
  };

  // Track if form has changes compared to initial values
  const hasChangesLocal = useCallback(() => {
    // Check if any form field has changed
    const initialLocation = initialFormValues.location ?? null;
    const currentLocation = testCase.location ?? null;
    const locationChanged =
      (performanceMode || initialFormValues.type === "performance") &&
      currentLocation !== initialLocation;

    const formFieldsChanged =
      testCase.title !== (initialFormValues.title || "") ||
      testCase.description !== (initialFormValues.description || "") ||
      testCase.priority !== (initialFormValues.priority || "medium") ||
      testCase.type !== (initialFormValues.type || "browser") ||
      locationChanged;

    // Check if editor content has changed
    const editorChanged = editorContent !== initialEditorContentProp;

    // Check if tags have changed
    const tagsChanged = (() => {
      if (!initialTags) return selectedTags.length > 0;

      if (initialTags.length !== selectedTags.length) return true;

      // Check if the same tags are selected (compare by ID)
      const initialTagIds = new Set(initialTags.map((tag: Tag) => tag.id));
      const selectedTagIds = new Set(selectedTags.map((tag: Tag) => tag.id));

      return (
        initialTagIds.size !== selectedTagIds.size ||
        !Array.from(initialTagIds).every((id: string) => selectedTagIds.has(id))
      );
    })();

    return formFieldsChanged || editorChanged || tagsChanged;
  }, [
    testCase,
    editorContent,
    initialFormValues,
    initialEditorContentProp,
    selectedTags,
    initialTags,
    performanceMode,
  ]);

  // Check if ONLY form fields changed (not the script)
  const onlyFormFieldsChanged = useMemo(() => {
    const initialLocation = initialFormValues.location ?? null;
    const currentLocation = testCase.location ?? null;
    const locationChanged =
      (performanceMode || initialFormValues.type === "performance") &&
      currentLocation !== initialLocation;

    const formFieldsChanged =
      testCase.title !== (initialFormValues.title || "") ||
      testCase.description !== (initialFormValues.description || "") ||
      testCase.priority !== (initialFormValues.priority || "medium") ||
      testCase.type !== (initialFormValues.type || "browser") ||
      locationChanged;

    // Check if tags have changed
    const tagsChanged = (() => {
      if (!initialTags) return selectedTags.length > 0;
      if (initialTags.length !== selectedTags.length) return true;
      const initialTagIds = new Set(initialTags.map((tag: Tag) => tag.id));
      const selectedTagIds = new Set(selectedTags.map((tag: Tag) => tag.id));
      return (
        initialTagIds.size !== selectedTagIds.size ||
        !Array.from(initialTagIds).every((id: string) => selectedTagIds.has(id))
      );
    })();

    // Script has NOT changed
    const scriptUnchanged = editorContent === initialEditorContentProp;

    // Only form fields changed if: (form or tags changed) AND script is unchanged
    return (formFieldsChanged || tagsChanged) && scriptUnchanged;
  }, [
    testCase,
    editorContent,
    initialFormValues,
    initialEditorContentProp,
    selectedTags,
    initialTags,
    performanceMode,
  ]);

  // Update formChanged state whenever form values change
  useEffect(() => {
    const hasChanges = hasChangesLocal();
    setFormChanged(hasChanges);
  }, [
    testCase,
    editorContent,
    initialFormValues,
    initialEditorContentProp,
    hasChangesLocal,
  ]);

  // STRICT SAVE CONTROLS: Determine if save/update should be disabled
  const isSaveDisabled = useMemo(() => {
    // Always disabled if running or submitting
    if (isRunning || isSubmitting) return true;

    // Disabled if no changes
    if (!formChanged) return true;

    // For NEW tests (no testId): script must pass before saving
    if (!testId) {
      if (!isCurrentScriptReadyToSave) return true;
      return false;
    }

    // For EXISTING tests (has testId):
    // - If only form fields changed (not script): allow save without rerun
    // - If script changed: require rerun
    if (onlyFormFieldsChanged) {
      // Only form/tags changed, script unchanged - allow save
      return false;
    }

    // Script changed - require validation and execution
    if (!isCurrentScriptReadyToSave) return true;

    return false;
  }, [isRunning, isSubmitting, formChanged, isCurrentScriptReadyToSave, onlyFormFieldsChanged, testId]);

  // Get the save button message with validation feedback
  const getSaveButtonMessage = () => {
    if (isRunning) return "Script is running, please wait";
    if (!formChanged) return "No changes detected, nothing to save";
    if (isSubmitting) return "Saving...";

    // For existing tests with only form changes, no message needed
    if (testId && onlyFormFieldsChanged) {
      return null;
    }

    // For new tests or when script changed, check validation and execution
    if (!isCurrentScriptValidated) {
      return "Script must be validated before saving";
    }

    // Check test execution status
    if (testExecutionStatus === "none") {
      return "Script must pass execution before saving";
    }

    if (testExecutionStatus === "failed") {
      return "Script must pass execution before saving";
    }

    return null;
  };

  const saveButtonMessage = getSaveButtonMessage();

  // Make the resetUpdateState function available to the parent component
  useEffect(() => {
    // Reset the update state function defined inside the useEffect
    const resetUpdateState = () => {
      // Code simplified to avoid unused variables
    };
    // When testId changes, reset the update state
    resetUpdateState();
  }, [testId, testCase, testCase.type, testCase.priority]);

  // Helper function to parse Zod validation errors and return user-friendly messages
  const parseValidationErrors = (errorMessage: string): string => {
    try {
      // Try to parse the error as JSON (Zod validation errors)
      const errors = JSON.parse(errorMessage);

      if (Array.isArray(errors)) {
        const fieldErrors = errors.map(
          (error: {
            path?: string[];
            message?: string;
            code?: string;
            maximum?: number;
            minimum?: number;
          }) => {
            const field = error.path?.[0] || "field";
            const message = error.message || "Invalid value";

            // Map common Zod error codes to user-friendly messages
            switch (error.code) {
              case "too_big":
                return `${field.charAt(0).toUpperCase() + field.slice(1)
                  } is too long. Maximum ${error.maximum} characters allowed.`;
              case "too_small":
                return `${field.charAt(0).toUpperCase() + field.slice(1)
                  } is too short. Minimum ${error.minimum} characters required.`;
              case "invalid_type":
                return `${field.charAt(0).toUpperCase() + field.slice(1)
                  } has an invalid format.`;
              case "invalid_string":
                return `${field.charAt(0).toUpperCase() + field.slice(1)
                  } format is invalid.`;
              default:
                return `${field.charAt(0).toUpperCase() + field.slice(1)
                  }: ${message}`;
            }
          }
        );

        return fieldErrors.join("\n");
      }
    } catch {
      // If it's not JSON, return the original error message
      return errorMessage;
    }

    return errorMessage;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (validateForm()) {
      // Convert the editor content to base64 before saving
      // Use the browser's btoa function for base64 encoding
      const base64Script = btoa(unescape(encodeURIComponent(editorContent)));

      // Update the test case with base64-encoded script

      const { location: _playgroundLocation, ...testCaseForSave } = testCase;
      const updatedTestCase = {
        ...testCaseForSave,
        script: base64Script,
        // Ensure description is at least an empty string if null
        description: testCase.description || "",
      };

      try {
        // If we have a testId, update the existing test
        if (testId) {
          const result = await saveTest({
            id: testId,
            ...updatedTestCase,
            // Note: requirementId is not passed for updates - the link is already established
          });

          if (result.success) {
            // Save tags after successful test update
            await saveTestTags(testId);

            toast.success("Test updated successfully.");

            // Invalidate React Query cache to ensure fresh data on tests page
            queryClient.invalidateQueries({ queryKey: TESTS_QUERY_KEY, refetchType: 'all' });

            // Navigate to the tests page after updating
            router.push("/tests/");
          } else {
            console.error("Failed to update test:", result.error);
            const errorMessage = parseValidationErrors(
              result.error || "Unknown error occurred"
            );
            toast.error("Validation Error", {
              description: errorMessage,
            });
          }
        } else {
          // Save as a new test
          // Include requirementId if we're creating from a requirement context
          const result = await saveTest({
            ...updatedTestCase,
            requirementId: initialLinkedRequirement?.id,
          });

          if (result.success && result.id) {
            // Save tags after successful test creation
            await saveTestTags(result.id);

            toast.success("Test saved successfully.");

            // Invalidate React Query cache to ensure fresh data on tests page
            queryClient.invalidateQueries({ queryKey: TESTS_QUERY_KEY, refetchType: 'all' });
            
            // If linked to a requirement, also invalidate requirements cache for updated counts
            if (initialLinkedRequirement?.id) {
              queryClient.invalidateQueries({ queryKey: REQUIREMENTS_QUERY_KEY, refetchType: 'all' });
            }

            // Navigate to the tests page with the test ID
            router.push("/tests/");
          } else {
            console.error("Failed to save test:", result.error);
            const errorMessage = parseValidationErrors(
              result.error || "Unknown error occurred"
            );
            toast.error("Validation Error", {
              description: errorMessage,
            });
          }
        }
      } catch (err) {
        console.error("Error saving test:", err);
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error occurred";
        const parsedError = parseValidationErrors(errorMessage);
        toast.error("Error", {
          description: parsedError,
        });
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setIsSubmitting(false);
      // Show validation errors
      const errorMessages = Object.values(errors).filter(Boolean);
      const errorDescription =
        errorMessages.length > 0
          ? errorMessages.join("\n")
          : "Please fix the form errors before saving.";

      toast.error("Form Validation Error", {
        description: errorDescription,
      });
    }
  };

  // Decode the script when the component mounts or when initialEditorContent changes
  React.useEffect(() => {
    // Only try to decode if there's content and it might be base64
    if (initialEditorContentProp && initialEditorContentProp.trim() !== "") {
      const decodeScript = async () => {
        try {
          // Try to decode the script
          const decodedScript = await decodeTestScript(
            initialEditorContentProp
          );

          // Only update if the decoded script is different
          if (decodedScript !== initialEditorContentProp) {
            setInitialEditorContent(decodedScript);
          }
        } catch {
          console.error("Error decoding script");
          // If decoding fails, keep the original content
        }
      };

      decodeScript();
    }
  }, [initialEditorContentProp, setInitialEditorContent]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Test metadata section with dates and ID */}
      {testId && (
        <div className="space-y-3">
          {/* Timestamps */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {testCase.createdAt && (
              <div className="space-y-1 bg-card p-3 rounded-lg border border-border/40">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Created
                </h3>
                <div>
                  <p className="text-xs">
                    {new Date(testCase.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}{" "}
                    {new Date(testCase.createdAt).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      try {
                        const date = new Date(testCase.createdAt);
                        if (isNaN(date.getTime())) return "Invalid date";
                        return formatDistanceToNow(date, { addSuffix: true });
                      } catch {
                        return "Invalid date";
                      }
                    })()}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1 bg-card p-3 rounded-lg border border-border/40">
              <h3 className="text-sm font-medium text-muted-foreground">
                Updated
              </h3>
              <div>
                {testCase.updatedAt ? (
                  <>
                    <p className="text-xs">
                      {new Date(testCase.updatedAt).toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        }
                      )}{" "}
                      {new Date(testCase.updatedAt).toLocaleTimeString(
                        "en-US",
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                        }
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        try {
                          const date = new Date(testCase.updatedAt);
                          if (isNaN(date.getTime())) return "Invalid date";
                          return formatDistanceToNow(date, { addSuffix: true });
                        } catch {
                          return "Invalid date";
                        }
                      })()}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Not updated</p>
                )}
              </div>
            </div>
          </div>

          {/* Test ID */}
          {/* <div className="bg-card p-3 rounded-lg border border-border/40">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">Test ID</h3>
              <div className="group relative">
            <UUIDField 
              value={testId} 
                  className="text-xs font-mono"
              onCopy={() => toast.success("Test ID copied to clipboard")}
            />
              </div>
            </div>
          </div> */}
        </div>
      )}

      {/* Linked Requirement Display */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground">Requirement</label>
        {linkedReq ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center text-sm p-3 rounded-md border bg-muted/30">
            <a
              href={`/requirements?id=${linkedReq.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium truncate hover:underline hover:text-primary transition-colors cursor-pointer"
              title={linkedReq.title}
            >
              {linkedReq.title}
            </a>

            <a
              href={linkedReq.externalUrl || `/requirements?id=${linkedReq.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors shrink-0 flex items-center"
              title={linkedReq.externalUrl ? "Open External Link" : "Open Requirement Details"}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground p-3 rounded-md border border-dashed bg-muted/10">
            Not Linked
          </div>
        )}
      </div>

      {/* Test title */}
      <div className="space-y-2">
        <label
          htmlFor="title"
          className={cn("block text-sm font-medium text-foreground")}
        >
          Title
        </label>
        <div>
          <Input
            id="title"
            name="title"
            type="text"
            value={testCase.title}
            onChange={(e) =>
              setTestCase({ ...testCase, title: e.target.value.slice(0, 255) })
            }
            placeholder="Enter test title"
            className={cn("h-10")}
            disabled={isRunning}
          />
        </div>
        <div className="flex justify-between items-center">
          {errors.title && (
            <p className="text-red-500 text-xs">{errors.title}</p>
          )}
          <p
            className={cn(
              "text-xs ml-auto",
              testCase.title.length > 240
                ? "text-orange-500"
                : "text-muted-foreground"
            )}
          >
            {testCase.title.length}/255
          </p>
        </div>
      </div>

      <div className="space-y-2 -mt-2">
        <label htmlFor="description" className="block text-sm font-medium">
          Description
        </label>
        <Textarea
          id="description"
          value={testCase.description || ""}
          onChange={(e) =>
            setTestCase((prev) => ({
              ...prev,
              description: e.target.value.slice(0, 1000), // Enforce 1000 char limit
            }))
          }
          placeholder="Enter test description"
          maxLength={1000}
          style={{ overflowY: "auto", minHeight: 100, maxHeight: 150 }}
          className={cn(
            "min-h-[100px]",
            isRunning ? "opacity-70 cursor-not-allowed" : ""
          )}
          disabled={isRunning}
        />
        <div className="flex justify-between items-center">
          {errors.description && (
            <p className="text-red-500 text-xs">{errors.description}</p>
          )}
          <p
            className={cn(
              "text-xs ml-auto",
              (testCase.description?.length || 0) > 950
                ? "text-orange-500"
                : "text-muted-foreground"
            )}
          >
            {testCase.description?.length || 0}/1000
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="priority" className="block text-sm font-medium">
            Priority
          </label>
          <Select
            value={testCase.priority || "medium"}
            onValueChange={(value) =>
              setTestCase((prev) => ({
                ...prev,
                priority: value as TestPriority,
              }))
            }
            defaultValue="medium"
            disabled={isRunning}
          >
            <SelectTrigger
              className={cn(
                "h-10",
                isRunning ? "opacity-70 cursor-not-allowed" : ""
              )}
            >
              <SelectValue placeholder="Select priority">
                {(() => {
                  const selected = priorities.find(
                    (p) => p.value === testCase.priority
                  );
                  if (!selected) return "Select priority";
                  const Icon = selected.icon;
                  return (
                    <span className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", selected.color)} />
                      {selected.label}
                    </span>
                  );
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {priorities.map((priority) => {
                const Icon = priority.icon;
                return (
                  <SelectItem key={priority.value} value={priority.value}>
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", priority.color)} />
                      {priority.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {errors.priority && (
            <p className="mt-1.5 text-xs text-red-500">{errors.priority}</p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="type" className="block text-sm font-medium">
            Type
          </label>
          {/* Type display - read-only since type is determined by URL scriptType parameter */}
          <div
            className={cn(
              "flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm",
              "cursor-default"
            )}
          >
            {(() => {
              const selected =
                availableTypes.find((t) => t.value === testCase.type) ||
                availableTypes[0];
              if (!selected) return <span className="text-muted-foreground">No type</span>;
              const Icon = selected.icon;
              return (
                <span className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", selected.color)} />
                  {selected.label}
                </span>
              );
            })()}
          </div>
          {errors.type && (
            <p className="mt-1.5 text-xs text-red-500">{errors.type}</p>
          )}
        </div>

      </div>

      {/* Tags Section */}
      <div className="space-y-2 mb-6">
        <label htmlFor="tags" className="block text-sm font-medium">
          Tags
        </label>
        <TagSelector
          value={selectedTags}
          onChange={handleTagChange}
          availableTags={availableTags}
          onCreateTag={canUserCreateTags ? handleCreateTag : undefined}
          onDeleteTag={canUserDeleteTags ? handleDeleteTag : undefined}
          canDeleteTag={canDeleteSpecificTag}
          placeholder="Select or create tags to organize tests..."
          disabled={isRunning || isLoadingTags}
        />
        {/* {isLoadingTags && (
          <p className="text-xs text-muted-foreground">Loading tags...</p>
        )} */}
      </div>

      <div className="mt-4">
        <div className="flex justify-between items-center">
          <div className="flex flex-col items-end -mt-6.5">
            {testId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDeleteDialog(true)}
                disabled={isRunning || !canUserDeleteTests}
                className="h-9 px-3 flex items-center text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/50"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex flex-col items-end">
            {testId ? (
              <Button
                type="submit"
                onClick={handleSubmit}
                className="flex items-center gap-2 h-9 px-4 mt-2"
                disabled={isSaveDisabled}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <SaveIcon className="h-4 w-4 mr-2" />
                )}
                {isSubmitting ? "Updating..." : "Update"}
              </Button>
            ) : (
              <Button
                type="submit"
                onClick={handleSubmit}
                className="flex items-center gap-2 h-9 px-4"
                disabled={isSaveDisabled}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <SaveIcon className="h-4 w-4 mr-2" />
                )}
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            )}
            {/* Professional single-row status message below save/update button */}
            <div className="mt-2 text-right min-h-[16px]">
              {/* Show a single, contextual status message */}
              {(() => {
                // Priority 1: Show blocking message if save is disabled
                if (saveButtonMessage && (isRunning || isSubmitting)) {
                  return (
                    <div className="flex items-center justify-end gap-1.5 mt-2">
                      <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse"></div>
                      <p className="text-xs text-muted-foreground font-medium">
                        {saveButtonMessage}
                      </p>
                    </div>
                  );
                }

                // Priority 2: Show validation/execution requirements
                if (saveButtonMessage && !isRunning && !isSubmitting) {
                  const isValidationIssue = !isCurrentScriptValidated;
                  const isExecutionIssue =
                    isCurrentScriptValidated &&
                    testExecutionStatus !== "passed";

                  return (
                    <div className="flex items-center justify-end gap-1.5 mt-2">
                      <div
                        className={`w-2 h-2 rounded-full ${isValidationIssue
                          ? "bg-blue-500"
                          : isExecutionIssue
                            ? "bg-red-500"
                            : "bg-gray-400"
                          }`}
                      ></div>
                      <p
                        className={`text-xs font-medium ${isValidationIssue
                          ? "text-muted-foreground"
                          : isExecutionIssue
                            ? "text-muted-foreground"
                            : "text-muted-foreground"
                          }`}
                      >
                        {isValidationIssue
                          ? "Run script to validate and save"
                          : isExecutionIssue
                            ? "Script must pass to save the test"
                            : saveButtonMessage}
                      </p>
                    </div>
                  );
                }

                // Priority 3: Show ready state
                const isReadyToSave = !saveButtonMessage &&
                  formChanged &&
                  !isRunning &&
                  !isSubmitting &&
                  (isCurrentScriptReadyToSave || (testId && onlyFormFieldsChanged));

                if (isReadyToSave) {
                  return (
                    <div className="flex items-center justify-end gap-1.5 mt-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <p className="text-xs text-emerald-600 font-medium">
                        Ready to {testId ? "update" : "save"} the test
                      </p>
                    </div>
                  );
                }

                // Priority 4: Show no changes state
                if (!formChanged && !isRunning && !isSubmitting) {
                  return (
                    <div className="flex items-center justify-end gap-1.5 mt-2">
                      <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                      <p className="text-xs text-gray-500 font-medium">
                        No changes to save
                      </p>
                    </div>
                  );
                }

                // Default: Empty space to maintain layout
                return null;
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Test</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the test{" "}
              <span className="font-semibold">
                &quot;{testCase.title}&quot;
              </span>
              . This action cannot be undone.
              <br />
              <br />
              <strong>Note:</strong> If this test is currently used in any jobs,
              the deletion will be prevented and you&apos;ll need to remove the
              test from those jobs first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!testId) return;

                setIsDeleting(true);
                try {
                  const result = await deleteTest(testId);
                  if (result.success) {
                    toast.success("Test deleted successfully");

                    // Invalidate Tests cache to ensure fresh data on tests list
                    queryClient.invalidateQueries({ queryKey: TESTS_QUERY_KEY, refetchType: 'all' });

                    router.push("/tests");
                  } else {
                    toast.error("Failed to delete test");
                  }
                } catch {
                  toast.error("Error deleting test");
                } finally {
                  setIsDeleting(false);
                  setShowDeleteDialog(false);
                }
              }}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

export { testCaseSchema };
export type { TestCaseFormData };
