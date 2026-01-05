"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/form";
import { Loader2, SaveIcon, Trash2, ArrowUp, ArrowRight, ArrowDown } from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createRequirement, updateRequirement, linkTestsToRequirement, unlinkTestFromRequirement, deleteRequirement } from "@/actions/requirements";
import { REQUIREMENTS_QUERY_KEY } from "@/hooks/use-requirements";
import type { CreateRequirementInput, UpdateRequirementInput } from "@/actions/requirements";
import { TagSelector, type Tag } from "@/components/ui/tag-selector";
import { useTags, useTagMutations } from "@/hooks/use-tags";
import { getLinkedTests, type LinkedTest } from "@/actions/requirements";
import { useQuery } from "@tanstack/react-query";
import TestSelector from "@/components/shared/test-selector";
import { Test } from "@/components/jobs/schema";

// Form schema - following best practices like job form
const requirementFormSchema = z.object({
    title: z.string()
        .min(3, "Title must be at least 3 characters")
        .max(200, "Title must be less than 200 characters"),
    description: z.string()
        .min(10, "Description must be at least 10 characters")
        .max(2000, "Description must be less than 2000 characters"),
    priority: z.enum(["low", "medium", "high"], {
        required_error: "Priority is required",
    }),
    tags: z.string().max(500, "Tags are too long").optional().nullable(),
    externalId: z.string().max(100, "External ID is too long").optional().nullable(),
    externalUrl: z.string().url("Invalid URL format").max(500).optional().nullable().or(z.literal("")),
    externalProvider: z.string().max(50).optional().nullable(),
    // Client-side only field for provider type dropdown
    providerType: z.enum(["Jira", "GitHub", "Linear", "Other"]).optional(),
});

type FormData = z.infer<typeof requirementFormSchema>;

type RequirementFormProps = {
    mode: "create" | "edit";
    defaultValues?: Partial<FormData> & { id?: string };
    onSuccess?: (id: string) => void;
    onCancel?: () => void;
};

export function RequirementForm({
    mode,
    defaultValues,
    onSuccess,
    onCancel,
}: RequirementFormProps) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedTests, setSelectedTests] = useState<Test[]>([]);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Tag management
    const { tags: availableTags, isLoading: isLoadingTags } = useTags();
    const { createTag, deleteTag } = useTagMutations();

    // Helper: Convert comma-separated string to Tag[]
    const stringToTags = (tagsString: string | null | undefined): Tag[] => {
        if (!tagsString) return [];
        return tagsString.split(",")
            .map(t => t.trim())
            .filter(t => t.length > 0)
            .map(name => {
                const existing = availableTags.find(t => t.name.toLowerCase() === name.toLowerCase());
                return existing || {
                    id: `temp-${name}`,
                    name,
                    color: name.toLowerCase() === "ai" ? "#a855f7" : null
                };
            });
    };

    const form = useForm<FormData>({
        resolver: zodResolver(requirementFormSchema),
        mode: "onSubmit",
        defaultValues: {
            title: defaultValues?.title ?? "",
            description: defaultValues?.description ?? "",
            priority: defaultValues?.priority ?? "medium",
            tags: defaultValues?.tags ?? "",
            externalId: defaultValues?.externalId ?? "",
            externalUrl: defaultValues?.externalUrl ?? "",
            externalProvider: defaultValues?.externalProvider ?? "",
            providerType: ["Jira", "GitHub", "Linear"].includes(defaultValues?.externalProvider ?? "")
                ? (defaultValues?.externalProvider as "Jira" | "GitHub" | "Linear")
                : (defaultValues?.externalProvider ? "Other" : undefined),
        },
    });

    // Fetch linked tests if in edit mode
    const requirementId = defaultValues?.id;
    const { data: linkedTests = [] } = useQuery<LinkedTest[]>({
        queryKey: ["requirement-linked-tests", requirementId],
        queryFn: async () => requirementId ? getLinkedTests(requirementId) : [],
        enabled: !!requirementId && mode === "edit",
    });

    // Sync linked tests with selected tests state
    useEffect(() => {
        if (linkedTests.length > 0 && mode === "edit") {
            const mappedTests: Test[] = linkedTests.map(t => ({
                id: t.id,
                name: t.name,
                description: t.description,
                type: t.type as any, // Cast to match Test type
                status: "running", // Default
                lastRunAt: null,
                duration: null,
                tags: t.tags
            }));
            setSelectedTests(mappedTests);
        }
    }, [linkedTests, mode]);

    const onSubmit = form.handleSubmit(async (values: FormData) => {
        setIsSubmitting(true);

        try {
            const cleanedData = {
                ...values,
                externalId: values.externalId && values.externalId.length > 0 ? values.externalId : null,
                externalUrl: values.externalUrl && values.externalUrl.length > 0 ? values.externalUrl : null,
                // If provider type is not 'Other', use the type as the provider name.
                // If it is 'Other', keep the manually entered externalProvider value.
                externalProvider: values.providerType && values.providerType !== "Other"
                    ? values.providerType
                    : (values.externalProvider && values.externalProvider.length > 0 ? values.externalProvider : null),
            };

            // Clean un-needed client-side fields
            delete (cleanedData as any).providerType;

            let targetId = requirementId;

            if (mode === "create") {
                const result = await createRequirement(cleanedData as CreateRequirementInput);
                if (!result.success) {
                    throw new Error(result.error || "Failed to create requirement");
                }
                targetId = result.id;
                toast.success("Requirement created");
            } else {
                if (!targetId) throw new Error("Missing requirement ID");
                const result = await updateRequirement({
                    id: targetId,
                    ...cleanedData,
                } as UpdateRequirementInput);
                if (!result.success) {
                    throw new Error(result.error || "Failed to update requirement");
                }
                toast.success("Requirement updated");
            }

            // Handle Test Linking/Unlinking
            if (targetId) {
                const currentIds = selectedTests.map(t => t.id);
                // For create mode, initial linked is empty. For edit, use fetched linkedTests.
                const originalIds = mode === "edit" ? linkedTests.map(t => t.id) : [];

                const toLink = currentIds.filter(id => !originalIds.includes(id));
                const toUnlink = originalIds.filter(id => !currentIds.includes(id));

                if (toLink.length > 0) {
                    await linkTestsToRequirement(targetId, toLink);
                }

                // Unlink one by one (since we don't have bulk unlink exposed yet)
                if (toUnlink.length > 0) {
                    await Promise.all(toUnlink.map(id => unlinkTestFromRequirement(targetId!, id)));
                }
            }

            queryClient.invalidateQueries({ queryKey: REQUIREMENTS_QUERY_KEY, refetchType: 'all' });
            if (targetId) {
                queryClient.invalidateQueries({ queryKey: ["requirement-linked-tests", targetId], refetchType: 'all' });
            }

            if (onSuccess && targetId) {
                onSuccess(targetId);
            } else {
                router.push("/requirements");
            }

        } catch (error) {
            console.error("Failed to save requirement:", error);
            toast.error("Failed to save requirement", {
                description: error instanceof Error ? error.message : "An unexpected error occurred",
            });
        } finally {
            setIsSubmitting(false);
        }
    });

    const handleCancel = () => {
        router.push("/requirements");
    };

    const handleDelete = async () => {
        if (!requirementId) return;
        setIsDeleting(true);
        try {
            const result = await deleteRequirement(requirementId);
            if (!result.success) {
                throw new Error(result.error || "Failed to delete requirement");
            }
            toast.success("Requirement deleted");
            queryClient.invalidateQueries({ queryKey: REQUIREMENTS_QUERY_KEY, refetchType: 'all' });
            router.push("/requirements");
        } catch (error) {
            console.error("Failed to delete requirement:", error);
            toast.error("Failed to delete requirement", {
                description: error instanceof Error ? error.message : "An unexpected error occurred",
            });
        } finally {
            setIsDeleting(false);
            setShowDeleteDialog(false);
        }
    };

    return (
        <div className="space-y-4 p-4">
            <Card className="h-full">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6">
                    <div>
                        <CardTitle>
                            {mode === "create" ? "Create New Requirement" : "Edit Requirement"}
                        </CardTitle>
                        <CardDescription className="mt-2">
                            {mode === "create"
                                ? "Define a testable requirement for your project"
                                : "Update requirement details"}
                        </CardDescription>
                    </div>
                    {mode === "edit" && (
                        <div className="flex space-x-2">
                            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Delete
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This action cannot be undone. This will permanently delete the requirement.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            onClick={(e) => {
                                                e.preventDefault();
                                                handleDelete();
                                            }}
                                            className="bg-red-600 hover:bg-red-700"
                                            disabled={isDeleting}
                                        >
                                            {isDeleting ? "Deleting..." : "Delete"}
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    )}
                </CardHeader>
                <CardContent className="space-y-6">
                    <Form {...form}>
                        <form onSubmit={onSubmit} className="space-y-6">
                            <div className="flex flex-col space-y-8">
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
                                    {/* Left Column: Core Details */}
                                    <div className="space-y-6">
                                        <div className="space-y-4">
                                            <FormField
                                                control={form.control}
                                                name="title"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Title</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                {...field}
                                                                placeholder="User should be able to..."
                                                                disabled={isSubmitting}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="description"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Description</FormLabel>
                                                        <FormControl>
                                                            <Textarea
                                                                {...field}
                                                                value={field.value ?? ""}
                                                                placeholder="Detailed description of the requirement..."
                                                                className="min-h-[120px]"
                                                                disabled={isSubmitting}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>

                                    {/* Right Column: Metadata & Links */}
                                    <div className="space-y-6">
                                        {/* External Links */}
                                        <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
                                            <div>
                                                <h4 className="font-medium text-sm">External Link</h4>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    Link to specific tickets or issues in other systems
                                                </p>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="providerType"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel className="text-xs">Provider</FormLabel>
                                                                <Select
                                                                    value={field.value}
                                                                    onValueChange={(val) => {
                                                                        field.onChange(val);
                                                                        // If switching away from Other, clear custom provider input or set it to the new type?
                                                                        // Actually, we want to clear the manual input if they pick a standard one?
                                                                        // For now, let's just update the type. The submit handler resolves the final value.
                                                                        if (val !== "Other") {
                                                                            form.setValue("externalProvider", val);
                                                                        } else {
                                                                            form.setValue("externalProvider", ""); // Clear for new input
                                                                        }
                                                                    }}
                                                                    disabled={isSubmitting}
                                                                >
                                                                    <FormControl>
                                                                        <SelectTrigger>
                                                                            <SelectValue placeholder="Select..." />
                                                                        </SelectTrigger>
                                                                    </FormControl>
                                                                    <SelectContent>
                                                                        <SelectItem value="Jira">Jira</SelectItem>
                                                                        <SelectItem value="GitHub">GitHub</SelectItem>
                                                                        <SelectItem value="Linear">Linear</SelectItem>
                                                                        <SelectItem value="Other">Other</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />

                                                    {form.watch("providerType") === "Other" && (
                                                        <FormField
                                                            control={form.control}
                                                            name="externalProvider"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <FormLabel className="text-xs">Specify Provider</FormLabel>
                                                                    <FormControl>
                                                                        <Input {...field} value={field.value ?? ""} placeholder="e.g. Asana" disabled={isSubmitting} />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                    )}


                                                </div>
                                                <FormField
                                                    control={form.control}
                                                    name="externalUrl"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-xs">URL</FormLabel>
                                                            <FormControl>
                                                                <Input {...field} value={field.value ?? ""} placeholder="https://..." disabled={isSubmitting} />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Test Selector - Full Width */}
                                <div className="space-y-2">
                                    <TestSelector
                                        selectedTests={selectedTests}
                                        onTestsSelected={setSelectedTests}
                                        buttonLabel="Link Tests"
                                        emptyStateMessage="No tests linked"
                                        required={false}
                                        hideExecutionOrder={true}
                                        entityName="requirement"
                                        headerActions={
                                            <div className="flex items-center gap-2">
                                                <FormField
                                                    control={form.control}
                                                    name="tags"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-0 w-[400px]">
                                                            <FormControl>
                                                                <div className="[&>div]:min-h-[36px] [&>div]:h-9">
                                                                    <TagSelector
                                                                        value={stringToTags(field.value)}
                                                                        onChange={(newTags) => {
                                                                            const tagString = newTags.map(t => t.name).join(", ");
                                                                            field.onChange(tagString);
                                                                        }}
                                                                        availableTags={availableTags}
                                                                        onCreateTag={async (name, color) => {
                                                                            return createTag.mutateAsync({ name, color });
                                                                        }}
                                                                        onDeleteTag={async (tagId) => {
                                                                            if (!tagId.startsWith("temp-")) {
                                                                                await deleteTag.mutateAsync(tagId);
                                                                            }
                                                                        }}
                                                                        placeholder="Tags..."
                                                                        disabled={isSubmitting || isLoadingTags}
                                                                        maxTags={5}

                                                                    />
                                                                </div>
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={form.control}
                                                    name="priority"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-0 w-[140px]">
                                                            <Select
                                                                value={field.value ?? undefined}
                                                                onValueChange={(value) => field.onChange(value as "low" | "medium" | "high")}
                                                                disabled={isSubmitting}
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger className="h-9">
                                                                        <SelectValue placeholder="Priority" />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent>
                                                                    <SelectItem value="high">
                                                                        <span className="flex items-center gap-2">
                                                                            <ArrowUp className="h-4 w-4 text-red-500" />
                                                                            High
                                                                        </span>
                                                                    </SelectItem>
                                                                    <SelectItem value="medium">
                                                                        <span className="flex items-center gap-2">
                                                                            <ArrowRight className="h-4 w-4 text-yellow-500" />
                                                                            Medium
                                                                        </span>
                                                                    </SelectItem>
                                                                    <SelectItem value="low">
                                                                        <span className="flex items-center gap-2">
                                                                            <ArrowDown className="h-4 w-4 text-blue-500" />
                                                                            Low
                                                                        </span>
                                                                    </SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        }
                                    />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end space-x-4 pt-6 border-t">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleCancel}
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    className="flex items-center"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                        <SaveIcon className="h-4 w-4 mr-2" />
                                    )}
                                    {isSubmitting
                                        ? "Saving..."
                                        : mode === "create"
                                            ? "Create Requirement"
                                            : "Save Changes"}
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
