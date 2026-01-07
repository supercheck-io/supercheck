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

/**
 * Convert technical error messages to user-friendly messages
 * Never expose raw technical errors, URLs, or stack traces to users
 */
function getUserFriendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    // Body size limit errors
    if (lowerMessage.includes("body exceeded") || lowerMessage.includes("body size limit")) {
        return "The file is too large to process. Please try a smaller document (under 10MB).";
    }

    // Network/timeout errors
    if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
        return "The request took too long. Please try again or use a smaller document.";
    }
    if (lowerMessage.includes("network") || lowerMessage.includes("fetch failed")) {
        return "Network error. Please check your connection and try again.";
    }

    // AI/extraction errors
    if (lowerMessage.includes("rate limit")) {
        return "Too many requests. Please wait a moment and try again.";
    }
    if (lowerMessage.includes("ai") && lowerMessage.includes("unavailable")) {
        return "AI service is temporarily unavailable. Please try again later.";
    }

    // File type errors
    if (lowerMessage.includes("unsupported file") || lowerMessage.includes("invalid file")) {
        return "Unsupported file type. Please upload a PDF, DOCX, Markdown, or TXT file.";
    }

    // Permission errors
    if (lowerMessage.includes("permission") || lowerMessage.includes("unauthorized")) {
        return "You don't have permission to perform this action.";
    }

    // Document processing errors - keep these as they're already user-friendly
    if (lowerMessage.includes("pdf") || lowerMessage.includes("docx") || lowerMessage.includes("document")) {
        // If it's already a reasonably friendly message about documents, use it
        if (!lowerMessage.includes("http") && !lowerMessage.includes("stack") && message.length < 150) {
            return message;
        }
        return "Failed to process the document. Please ensure it's a valid, readable file.";
    }

    // Generic fallback - never show technical details
    if (message.includes("http") || message.includes("://") || message.length > 150) {
        return "Something went wrong while processing your document. Please try again.";
    }

    // If the message looks reasonably user-friendly, use it
    return message.length > 0 ? message : "An unexpected error occurred. Please try again.";
}

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
                                    isCompleted && "bg-green-500/10 text-green-500",
                                    isActive && "bg-primary/10 text-primary ring-2 ring-primary/30",
                                    !isCompleted && !isActive && "bg-muted text-muted-foreground"
                                )}
                            >
                                <Icon className="h-5 w-5" />
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
            setError(getUserFriendlyError(err));
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
            setError(getUserFriendlyError(err));
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
                            <div className="border rounded-lg p-4 bg-muted/30">
                                <div className="flex items-center gap-2 mb-3">
                                    <Lightbulb className="h-4 w-4 text-amber-500" />
                                    <span className="font-medium text-sm">How it works</span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</div>
                                        <div>
                                            <p className="font-medium text-foreground">Upload your document</p>
                                            <p className="text-xs text-muted-foreground">PRD, spec, or requirements doc</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</div>
                                        <div>
                                            <p className="font-medium text-foreground">AI extracts requirements</p>
                                            <p className="text-xs text-muted-foreground">&quot;User should be able to...&quot; statements</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</div>
                                        <div>
                                            <p className="font-medium text-foreground">Review and select</p>
                                            <p className="text-xs text-muted-foreground">Choose which to create</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">4</div>
                                        <div>
                                            <p className="font-medium text-foreground">Requirements created</p>
                                            <p className="text-xs text-muted-foreground">Tagged as AI-generated</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-muted-foreground">
                                    <Info className="h-3 w-3 shrink-0" />
                                    <span>Documents are processed securely. Only testable requirements are extracted.</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Processing State */}
                    {(state === "uploading" || state === "extracting") && (
                        <div className="py-10 text-center">
                            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-primary/10 flex items-center justify-center">
                                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            </div>
                            <p className="text-lg font-semibold text-foreground mb-2">
                                {state === "uploading" ? "Uploading document..." : "Extracting requirements with AI..."}
                            </p>
                            <p className="text-sm text-muted-foreground mb-5">
                                {file?.name}
                            </p>
                            <Progress value={progress} className="max-w-sm mx-auto h-2" />
                            <p className="text-xs text-muted-foreground mt-3">
                                {state === "extracting" && "This may take a few seconds depending on document size"}
                            </p>
                        </div>
                    )}

                    {/* Review State */}
                    {state === "review" && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "w-10 h-10 rounded-lg flex items-center justify-center",
                                        extractedRequirements.length > 0 ? "bg-green-500/10" : "bg-amber-500/10"
                                    )}>
                                        <FileText className={cn(
                                            "h-5 w-5",
                                            extractedRequirements.length > 0 ? "text-green-500" : "text-amber-500"
                                        )} />
                                    </div>
                                    <div>
                                        <p className="font-medium">{file?.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {extractedRequirements.length} requirements found
                                        </p>
                                    </div>
                                </div>
                                {extractedRequirements.length > 0 && (
                                    <Button variant="ghost" size="sm" onClick={toggleAll}>
                                        {extractedRequirements.every((r) => r.selected) ? "Deselect All" : "Select All"}
                                    </Button>
                                )}
                            </div>

                            {extractedRequirements.length === 0 ? (
                                <div className="border rounded-lg p-6 bg-muted/20 text-center">
                                    <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                                        <AlertCircle className="h-6 w-6 text-amber-500" />
                                    </div>
                                    <p className="font-medium text-foreground mb-2">No testable requirements found</p>
                                    <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                                        The AI couldn&apos;t identify specific, testable requirements from this document. This might happen if the document:
                                    </p>
                                    <ul className="text-sm text-muted-foreground text-left max-w-sm mx-auto space-y-1 mb-4">
                                        <li>• Contains mostly high-level or marketing content</li>
                                        <li>• Lacks specific feature descriptions or API specs</li>
                                        <li>• Uses vague language without concrete acceptance criteria</li>
                                        <li>• Is an image-based PDF without extractable text</li>
                                    </ul>
                                    <p className="text-xs text-muted-foreground">
                                        Try uploading a more detailed PRD, API documentation, or technical specification.
                                    </p>
                                </div>
                            ) : (
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
                            )}

                            {extractedRequirements.length > 0 && (
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
                            )}

                            {extractedRequirements.length === 0 && (
                            <div className="flex justify-center pt-4">
                                <Button variant="outline" onClick={resetState}>
                                    Try Another Document
                                </Button>
                            </div>
                            )}
                        </div>
                    )}

                    {/* Creating State */}
                    {state === "creating" && (
                        <div className="py-10 text-center">
                            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-primary/10 flex items-center justify-center">
                                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            </div>
                            <p className="text-lg font-semibold text-foreground mb-2">Creating requirements...</p>
                            <p className="text-sm text-muted-foreground mb-5">
                                {Math.round((progress / 100) * selectedCount)} of {selectedCount} created
                            </p>
                            <Progress value={progress} className="max-w-sm mx-auto h-2" />
                        </div>
                    )}

                    {/* Done State */}
                    {state === "done" && (
                        <div className="py-6 text-center">
                            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
                                <CheckCircle2 className="h-7 w-7 text-green-500" />
                            </div>
                            
                            <p className="text-lg font-semibold text-green-500 mb-1">
                                Requirements created successfully!
                            </p>
                            <p className="text-sm text-muted-foreground mb-5">
                                {selectedCount} requirements are now ready for test coverage
                            </p>

                            {/* What's Next Section - matching How it works style */}
                            <div className="border rounded-lg p-4 bg-muted/30 text-left">
                                <div className="flex items-center gap-2 mb-3">
                                    <Lightbulb className="h-4 w-4 text-amber-500" />
                                    <span className="font-medium text-sm">What&apos;s Next?</span>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</div>
                                        <div>
                                            <p className="font-medium text-foreground">Select a requirement</p>
                                            <p className="text-xs text-muted-foreground">Click to view details and context</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</div>
                                        <div>
                                            <p className="font-medium text-foreground">Choose test type</p>
                                            <p className="text-xs text-muted-foreground">Browser, API, Database, or Performance</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</div>
                                        <div>
                                            <p className="font-medium text-foreground">Create your test</p>
                                            <p className="text-xs text-muted-foreground">AI generates script or use recorder</p>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">4</div>
                                        <div>
                                            <p className="font-medium text-foreground">Save & Link</p>
                                            <p className="text-xs text-muted-foreground">Auto-links test to requirement</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-muted-foreground">
                                    <Info className="h-3 w-3 shrink-0" />
                                    <span>Coverage status updates automatically when linked tests run in jobs.</span>
                                </div>
                            </div>

                            <div className="mt-5 flex justify-center">
                                <Button onClick={handleClose} size="lg" className="min-w-[120px]">
                                    Close
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {state === "error" && (
                        <div className="py-10 text-center">
                            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-red-500/10 flex items-center justify-center">
                                <AlertCircle className="h-8 w-8 text-red-500" />
                            </div>
                            <p className="text-lg font-semibold text-red-500 mb-2">
                                Something went wrong
                            </p>
                            <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">{error}</p>
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
