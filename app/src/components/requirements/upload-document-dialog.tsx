"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Upload,
    FileText,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Sparkles,
    X,
    FileUp,
    Search,
    ListChecks,
    Plus,
    ArrowUp,
    ArrowRight,
    ArrowDown,
    Lightbulb,
    Info,
} from "lucide-react";
import { toast } from "sonner";
import { extractRequirementsFromDocument } from "@/actions/extract-requirements";
import { createRequirement } from "@/actions/requirements";
import { cn } from "@/lib/utils";

interface ExtractedRequirement {
    id: string;
    title: string;
    description: string | null;
    priority: "low" | "medium" | "high" | null;
    tags: string[];
    selected: boolean;
}

interface UploadDocumentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete?: () => void;
}

type UploadState = "idle" | "uploading" | "extracting" | "review" | "creating" | "done" | "error";

const ACCEPTED_FILE_TYPES = {
    "application/pdf": [".pdf"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    "text/markdown": [".md"],
    "text/plain": [".txt"],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Step indicator component
function StepIndicator({ currentStep }: { currentStep: number }) {
    const steps = [
        { label: "Upload", icon: FileUp },
        { label: "Extract", icon: Search },
        { label: "Review", icon: ListChecks },
        { label: "Create", icon: Plus },
    ];

    return (
        <div className="flex items-center justify-center gap-2 py-4">
            {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;

                return (
                    <div key={step.label} className="flex items-center">
                        <div className="flex flex-col items-center">
                            <div
                                className={cn(
                                    "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                                    isCompleted && "bg-green-500/20 text-green-500",
                                    isActive && "bg-primary/20 text-primary ring-2 ring-primary/30",
                                    !isCompleted && !isActive && "bg-muted text-muted-foreground"
                                )}
                            >
                                {isCompleted ? (
                                    <CheckCircle2 className="h-5 w-5" />
                                ) : (
                                    <Icon className="h-5 w-5" />
                                )}
                            </div>
                            <span
                                className={cn(
                                    "text-xs mt-1.5 font-medium",
                                    isActive && "text-primary",
                                    isCompleted && "text-green-500",
                                    !isActive && !isCompleted && "text-muted-foreground"
                                )}
                            >
                                {step.label}
                            </span>
                        </div>
                        {index < steps.length - 1 && (
                            <div
                                className={cn(
                                    "w-12 h-0.5 mx-2 mt-[-1rem] transition-colors duration-300",
                                    isCompleted ? "bg-green-500" : "bg-muted"
                                )}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// Priority icon helper
function PriorityBadge({ priority }: { priority: "low" | "medium" | "high" | null }) {
    if (!priority) return null;

    const config = {
        high: { icon: ArrowUp, color: "text-red-500", bg: "bg-red-500/10" },
        medium: { icon: ArrowRight, color: "text-yellow-500", bg: "bg-yellow-500/10" },
        low: { icon: ArrowDown, color: "text-blue-500", bg: "bg-blue-500/10" },
    };

    const { icon: Icon, color, bg } = config[priority];

    return (
        <Badge variant="outline" className={cn("text-xs gap-1", bg, color)}>
            <Icon className="h-3 w-3" />
            {priority.charAt(0).toUpperCase() + priority.slice(1)}
        </Badge>
    );
}

export function UploadDocumentDialog({
    open,
    onOpenChange,
    onComplete,
}: UploadDocumentDialogProps) {
    const [state, setState] = useState<UploadState>("idle");
    const [progress, setProgress] = useState(0);
    const [file, setFile] = useState<File | null>(null);
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [extractedRequirements, setExtractedRequirements] = useState<ExtractedRequirement[]>([]);
    const [error, setError] = useState<string | null>(null);

    const getCurrentStep = (): number => {
        switch (state) {
            case "idle": return 0;
            case "uploading":
            case "extracting": return 1;
            case "review": return 2;
            case "creating":
            case "done": return 3;
            default: return 0;
        }
    };

    const resetState = () => {
        setState("idle");
        setProgress(0);
        setFile(null);
        setDocumentId(null);
        setExtractedRequirements([]);
        setError(null);
    };

    const handleClose = () => {
        if (state === "uploading" || state === "extracting" || state === "creating") {
            return; // Don't close while processing
        }
        resetState();
        onOpenChange(false);
    };

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const uploadedFile = acceptedFiles[0];
        if (!uploadedFile) return;

        setFile(uploadedFile);
        setState("uploading");
        setProgress(20);

        try {
            // Simulate upload progress
            setProgress(40);
            setState("extracting");

            // Extract requirements using AI
            const formData = new FormData();
            formData.append("file", uploadedFile);

            const result = await extractRequirementsFromDocument(formData);

            if (!result.success || !result.requirements) {
                throw new Error(result.error || "Failed to extract requirements");
            }

            setProgress(100);

            // Transform to include selection state
            const requirements: ExtractedRequirement[] = result.requirements.map(
                (req: { title: string; description?: string; priority?: string; tags?: string[] }, index: number) => ({
                    id: `extracted-${index}`,
                    title: req.title,
                    description: req.description || null,
                    priority: (req.priority as "low" | "medium" | "high") || null,
                    tags: req.tags || [],
                    selected: true,
                })
            );

            setExtractedRequirements(requirements);
            if (result.documentId) {
                setDocumentId(result.documentId);
            }
            setState("review");
        } catch (err) {
            console.error("Error extracting requirements:", err);
            setError(err instanceof Error ? err.message : "Failed to extract requirements");
            setState("error");
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ACCEPTED_FILE_TYPES,
        maxSize: MAX_FILE_SIZE,
        multiple: false,
        disabled: state !== "idle",
    });

    const toggleRequirement = (id: string) => {
        setExtractedRequirements((prev) =>
            prev.map((req) =>
                req.id === id ? { ...req, selected: !req.selected } : req
            )
        );
    };

    const toggleAll = () => {
        const allSelected = extractedRequirements.every((r) => r.selected);
        setExtractedRequirements((prev) =>
            prev.map((req) => ({ ...req, selected: !allSelected }))
        );
    };

    const handleCreateRequirements = async () => {
        const selectedRequirements = extractedRequirements.filter((r) => r.selected);
        if (selectedRequirements.length === 0) {
            toast.error("Please select at least one requirement");
            return;
        }

        setState("creating");
        setProgress(0);

        try {
            let created = 0;
            for (const req of selectedRequirements) {
                // Combine AI-extracted tags with 'ai' marker, avoiding duplicates
                const allTags = new Set(["ai", ...req.tags]);
                await createRequirement({
                    title: req.title,
                    description: req.description || "Extracted from document",
                    priority: req.priority || "medium",
                    tags: Array.from(allTags).join(", "),
                    sourceDocumentId: documentId,
                    createdBy: "ai",
                });
                created++;
                setProgress(Math.round((created / selectedRequirements.length) * 100));
            }

            setState("done");
            toast.success(`Created ${created} requirements from document`);

            // Invalidate React Query cache to refresh requirements list
            // Don't auto-close - let user read "What's Next" instructions
            onComplete?.();
        } catch (err) {
            console.error("Error creating requirements:", err);
            setError(err instanceof Error ? err.message : "Failed to create requirements");
            setState("error");
        }
    };

    const selectedCount = extractedRequirements.filter((r) => r.selected).length;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-5xl max-h-[90vh] min-w-4xl overflow-hidden flex flex-col">
                <DialogHeader className="pb-2">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Sparkles className="h-6 w-6 text-purple-500" />
                        Extract Requirements from Document
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                        Upload a PRD, spec, or requirements document. Our AI will extract testable requirements.
                    </DialogDescription>
                </DialogHeader>

                {/* Step Indicator */}
                {state !== "error" && <StepIndicator currentStep={getCurrentStep()} />}

                <div className="flex-1 overflow-auto">
                    {/* Idle State - Enhanced Dropzone */}
                    {state === "idle" && (
                        <div className="space-y-6">
                            <div
                                {...getRootProps()}
                                className={cn(
                                    "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-300",
                                    isDragActive
                                        ? "border-primary bg-primary/5 scale-[1.02]"
                                        : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
                                )}
                            >
                                <input {...getInputProps()} />
                                <div className="flex flex-col items-center">
                                    <div className={cn(
                                        "w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all duration-300",
                                        isDragActive ? "bg-primary/20" : "bg-muted"
                                    )}>
                                        <Upload className={cn(
                                            "h-8 w-8 transition-colors",
                                            isDragActive ? "text-primary" : "text-muted-foreground"
                                        )} />
                                    </div>
                                    <p className="text-lg font-semibold mb-1">
                                        {isDragActive ? "Drop your document here" : "Drag & drop your document"}
                                    </p>
                                    <p className="text-sm text-muted-foreground mb-5">
                                        or click to browse files
                                    </p>
                                    <div className="flex flex-wrap items-center justify-center gap-2">
                                        <Badge variant="secondary" className="px-3 py-1">PDF</Badge>
                                        <Badge variant="secondary" className="px-3 py-1">DOCX</Badge>
                                        <Badge variant="secondary" className="px-3 py-1">Markdown</Badge>
                                        <Badge variant="secondary" className="px-3 py-1">TXT</Badge>
                                        <span className="text-sm text-muted-foreground ml-2">• Max 10MB</span>
                                    </div>
                                </div>
                            </div>

                            {/* How it works section */}
                            <div className="border rounded-lg p-5 bg-muted/40">
                                <div className="flex items-center gap-2 mb-4">
                                    <Lightbulb className="h-5 w-5 text-muted-foreground" />
                                    <span className="font-semibold">How it works</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold shrink-0 border">1</div>
                                        <div>
                                            <p className="font-medium">Upload your document</p>
                                            <p className="text-muted-foreground">PRD, spec, or requirements doc</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold shrink-0 border">2</div>
                                        <div>
                                            <p className="font-medium">AI extracts requirements</p>
                                            <p className="text-muted-foreground">&quot;User should be able to...&quot; statements</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold shrink-0 border">3</div>
                                        <div>
                                            <p className="font-medium">Review and select</p>
                                            <p className="text-muted-foreground">Choose which to create</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold shrink-0 border">4</div>
                                        <div>
                                            <p className="font-medium">Requirements created</p>
                                            <p className="text-muted-foreground">Tagged as AI-generated</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-4 pt-4 border-t flex items-start gap-2 text-xs text-muted-foreground">
                                    <Info className="h-3 w-3 mt-0.5 shrink-0" />
                                    <span>Documents are processed securely. Only testable requirements are extracted.</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Processing State */}
                    {(state === "uploading" || state === "extracting") && (
                        <div className="py-12 text-center">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
                                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                            </div>
                            <p className="text-xl font-semibold mb-2">
                                {state === "uploading" ? "Uploading document..." : "Extracting requirements with AI..."}
                            </p>
                            <p className="text-muted-foreground mb-6">
                                {file?.name}
                            </p>
                            <Progress value={progress} className="max-w-sm mx-auto h-2" />
                            <p className="text-sm text-muted-foreground mt-3">
                                {state === "extracting" && "This may take a few seconds depending on document size"}
                            </p>
                        </div>
                    )}

                    {/* Review State */}
                    {state === "review" && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                                        <FileText className="h-5 w-5 text-green-500" />
                                    </div>
                                    <div>
                                        <p className="font-medium">{file?.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {extractedRequirements.length} requirements found
                                        </p>
                                    </div>
                                </div>
                                <Button variant="ghost" size="sm" onClick={toggleAll}>
                                    {extractedRequirements.every((r) => r.selected) ? "Deselect All" : "Select All"}
                                </Button>
                            </div>

                            <ScrollArea className="h-[320px] border rounded-lg">
                                <div className="p-3 space-y-2">
                                    {extractedRequirements.map((req) => (
                                        <div
                                            key={req.id}
                                            className={cn(
                                                "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all duration-200",
                                                req.selected
                                                    ? "bg-primary/5 border-primary/30 shadow-sm"
                                                    : "bg-muted/20 hover:bg-muted/40 border-transparent"
                                            )}
                                            onClick={() => toggleRequirement(req.id)}
                                        >
                                            <Checkbox
                                                checked={req.selected}
                                                onCheckedChange={() => toggleRequirement(req.id)}
                                                className="mt-0.5"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                                    <span className="font-medium">{req.title}</span>
                                                    <PriorityBadge priority={req.priority} />
                                                    {req.tags.map((tag) => (
                                                        <Badge key={tag} variant="secondary" className="text-xs">
                                                            {tag}
                                                        </Badge>
                                                    ))}
                                                </div>
                                                {req.description && (
                                                    <p className="text-sm text-muted-foreground line-clamp-2">
                                                        {req.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>

                            <div className="flex items-center justify-between pt-2 border-t">
                                <span className="text-sm text-muted-foreground">
                                    {selectedCount} of {extractedRequirements.length} selected
                                </span>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={handleClose}>
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleCreateRequirements}
                                        disabled={selectedCount === 0}
                                        className="gap-2"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Create {selectedCount} Requirements
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Creating State */}
                    {state === "creating" && (
                        <div className="py-12 text-center">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
                                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                            </div>
                            <p className="text-xl font-semibold mb-2">Creating requirements...</p>
                            <p className="text-muted-foreground mb-6">
                                {Math.round((progress / 100) * selectedCount)} of {selectedCount} created
                            </p>
                            <Progress value={progress} className="max-w-sm mx-auto h-2" />
                        </div>
                    )}

                    {/* Done State */}
                    {state === "done" && (
                        <div className="py-8 text-center">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/10 flex items-center justify-center">
                                <CheckCircle2 className="h-10 w-10 text-green-500" />
                            </div>
                            <p className="text-xl font-semibold text-green-600 mb-2">
                                Requirements created successfully!
                            </p>
                            <p className="text-muted-foreground mb-6">
                                {selectedCount} requirements are now ready for test coverage
                            </p>

                            {/* What's Next Guidance */}
                            <div className="max-w-lg mx-auto bg-muted/30 rounded-lg p-5 border border-border/50 text-left">
                                <div className="flex items-center gap-2 mb-4">
                                    <Lightbulb className="h-5 w-5 text-amber-500" />
                                    <span className="font-medium">What&apos;s Next?</span>
                                </div>
                                <ol className="text-sm text-muted-foreground space-y-2 mb-4 list-decimal list-inside">
                                    <li>Click on a requirement in the list to open its details</li>
                                    <li>In the <strong>&quot;Create Test&quot;</strong> section, choose your test type</li>
                                    <li><strong>API, Database, Performance:</strong> AI generates a test script from your requirement</li>
                                    <li><strong>Browser:</strong> Use the Playwright recorder to capture interactions</li>
                                    <li>Run the test and save to automatically link it to your requirement</li>
                                </ol>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-3 border-t border-border/50">
                                    <ArrowRight className="h-3 w-3 flex-shrink-0" />
                                    <span>Coverage status updates automatically when linked tests run in jobs</span>
                                </div>
                            </div>

                            <div className="mt-8">
                                <Button onClick={handleClose} size="lg" className="min-w-[120px]">
                                    Close
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {state === "error" && (
                        <div className="py-12 text-center">
                            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
                                <AlertCircle className="h-10 w-10 text-red-500" />
                            </div>
                            <p className="text-xl font-semibold text-red-600 mb-2">
                                Something went wrong
                            </p>
                            <p className="text-muted-foreground mb-6 max-w-md mx-auto">{error}</p>
                            <Button variant="outline" onClick={resetState} className="gap-2">
                                <X className="h-4 w-4" />
                                Try Again
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
