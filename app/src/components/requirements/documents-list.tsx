"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    FileText,
    Upload,
    Clock,
    Sparkles,
    FileUp,
    MoreHorizontal,
    Eye,
    Trash2,
    Download,
    ArrowUp,
    ArrowRight,
    ArrowDown,
    Loader2,
} from "lucide-react";
import { SuperCheckLoading } from "@/components/shared/supercheck-loading";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, format } from "date-fns";
import { UploadDocumentDialog } from "./upload-document-dialog";
import {
    getDocuments as getDocumentsAction,
    deleteDocument as deleteDocumentAction,
    getDocumentRequirements,
    getDocument as getDocumentAction,
} from "@/actions/documents";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { RequirementDocumentType } from "@/db/schema/types";
import { cn } from "@/lib/utils";

interface Document {
    id: string;
    name: string;
    type: string;
    uploadedAt: Date;
    extractedCount: number;
    fileSize: number | null;
    status: "processed" | "processing" | "failed";
}

interface DocumentsListProps {
    canUpload?: boolean;
}

// Empty state component
function EmptyDocumentsState({ onUpload }: { onUpload: () => void }) {
    return (
        <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-6">
                    <FileUp className="h-8 w-8 text-blue-500" />
                </div>
                <h3 className="text-xl font-semibold mb-2">No documents uploaded</h3>
                <p className="text-muted-foreground text-sm text-center max-w-md mb-6">
                    Upload your PRD, specs, or requirements documents. Our AI will extract testable
                    requirements automatically.
                </p>
                <Button onClick={onUpload} className="gap-2">
                    <Upload className="h-4 w-4" />
                    Upload Document
                </Button>
            </CardContent>
        </Card>
    );
}

// Priority badge for requirements list
function PriorityBadge({ priority }: { priority: string | null }) {
    if (!priority) return null;

    const config = {
        high: { icon: ArrowUp, color: "text-red-500 bg-red-500/10" },
        medium: { icon: ArrowRight, color: "text-yellow-500 bg-yellow-500/10" },
        low: { icon: ArrowDown, color: "text-blue-500 bg-blue-500/10" },
    };

    const { icon: Icon, color } = config[priority as keyof typeof config] || { icon: ArrowRight, color: "text-gray-500" };

    return (
        <Badge variant="outline" className={cn("text-xs gap-1 capitalize", color)}>
            <Icon className="h-3 w-3" />
            {priority}
        </Badge>
    );
}

// Document Details Dialog
function DocumentDetailsDialog({
    documentId,
    open,
    onOpenChange,
    onDownload,
}: {
    documentId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDownload: () => void;
}) {
    const [document, setDocument] = useState<Document | null>(null);
    const [requirements, setRequirements] = useState<{ id: string; title: string; priority: string | null; createdAt: Date | null }[]>([]);
    // Track if we've initiated a fetch for the current documentId
    const [fetchedDocId, setFetchedDocId] = useState<string | null>(null);

    // Fetch data when dialog opens with a new document
    const shouldFetch = open && documentId && documentId !== fetchedDocId;

    useEffect(() => {
        if (!shouldFetch) {
            return;
        }

        let cancelled = false;

        const fetchData = async () => {
            const [docResult, reqsResult] = await Promise.all([
                getDocumentAction(documentId!),
                getDocumentRequirements(documentId!),
            ]);

            if (cancelled) return;

            if (docResult.success && docResult.document) {
                setDocument({
                    id: docResult.document.id,
                    name: docResult.document.name,
                    type: docResult.document.type,
                    uploadedAt: docResult.document.uploadedAt ? new Date(docResult.document.uploadedAt) : new Date(),
                    extractedCount: docResult.document.extractedCount || 0,
                    fileSize: docResult.document.fileSize,
                    status: "processed",
                });
            }
            if (reqsResult.success && reqsResult.requirements) {
                setRequirements(reqsResult.requirements);
            }
            setFetchedDocId(documentId);
        };

        fetchData();

        return () => {
            cancelled = true;
        };
    }, [shouldFetch, documentId]);

    // Wrap onOpenChange to handle cleanup when dialog closes
    const handleOpenChange = useCallback((newOpen: boolean) => {
        if (!newOpen) {
            // Reset state when dialog closes
            setFetchedDocId(null);
            setDocument(null);
            setRequirements([]);
        }
        onOpenChange(newOpen);
    }, [onOpenChange]);

    // Derive loading state from whether we need to fetch
    const derivedIsLoading = shouldFetch || (open && documentId && !document);

    const formatFileSize = (bytes: number | null) => {
        if (!bytes) return "Unknown";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-4xl min-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Document Details
                    </DialogTitle>
                    <DialogDescription>
                        View document metadata and extracted requirements
                    </DialogDescription>
                </DialogHeader>

                {derivedIsLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : document ? (
                    <div className="space-y-6">
                        {/* Document Info */}
                        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/40 rounded-lg">
                            <div>
                                <p className="text-xs text-muted-foreground mb-1">File Name</p>
                                <p className="font-medium text-sm truncate" title={document.name}>{document.name}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground mb-1">Type</p>
                                <Badge variant="outline" className="uppercase text-xs">{document.type}</Badge>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground mb-1">File Size</p>
                                <p className="text-sm">{formatFileSize(document.fileSize)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground mb-1">Uploaded</p>
                                <p className="text-sm">{format(document.uploadedAt, "MMM d, yyyy 'at' h:mm a")}</p>
                            </div>
                        </div>

                        {/* Download Button */}
                        <Button onClick={onDownload} variant="outline" className="w-full gap-2">
                            <Download className="h-4 w-4" />
                            Download Document
                        </Button>

                        {/* Extracted Requirements */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-medium text-sm">Extracted Requirements</h4>
                                <Badge variant="secondary">{requirements.length} requirements</Badge>
                            </div>

                            {requirements.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground text-sm border rounded-lg bg-muted/20">
                                    No requirements extracted from this document
                                </div>
                            ) : (
                                <ScrollArea className="h-[200px] border rounded-lg">
                                    <div className="p-2 space-y-1">
                                        {requirements.map((req) => (
                                            <div
                                                key={req.id}
                                                className="flex items-center justify-between p-3 rounded-md hover:bg-muted/50 transition-colors"
                                            >
                                                <span className="text-sm truncate flex-1 mr-3">{req.title}</span>
                                                <PriorityBadge priority={req.priority} />
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-8 text-muted-foreground">
                        Document not found
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// Document card component
function DocumentCard({
    document,
    onView,
    onDelete,
    onDownload,
}: {
    document: Document;
    onView: () => void;
    onDelete: () => void;
    onDownload: () => void;
}) {
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    const getDocumentStyle = (type: string) => {
        const t = type.toLowerCase();
        if (t.includes("pdf")) {
            return {
                icon: FileText,
                color: "text-red-500",
                bg: "bg-red-500/10",
                label: "PDF"
            };
        }
        if (t.includes("docx") || t.includes("word") || t.includes("openxmlformats")) {
            return {
                icon: FileText,
                color: "text-blue-500",
                bg: "bg-blue-500/10",
                label: "DOCX"
            };
        }
        if (t.includes("md") || t.includes("markdown")) {
            return {
                icon: FileText,
                color: "text-cyan-500",
                bg: "bg-cyan-500/10",
                label: "MD"
            };
        }
        return {
            icon: FileText,
            color: "text-slate-500",
            bg: "bg-slate-500/10",
            label: "TXT"
        };
    };

    const style = getDocumentStyle(document.type);
    const Icon = style.icon;

    const getStatusBadge = (status: Document["status"]) => {
        switch (status) {
            case "processed":
                return <Badge variant="secondary" className="bg-green-500/10 text-green-500">Processed</Badge>;
            case "processing":
                return <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-500">Processing</Badge>;
            case "failed":
                return <Badge variant="secondary" className="bg-red-500/10 text-red-500">Failed</Badge>;
        }
    };

    return (
        <>
            <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${style.bg}`}>
                                <Icon className={`h-5 w-5 ${style.color}`} />
                            </div>
                            <div>
                                <h4 className="font-medium text-sm truncate max-w-[150px]" title={document.name}>{document.name}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="outline" className="text-xs">
                                        {style.label}
                                    </Badge>
                                    {getStatusBadge(document.status)}
                                </div>
                            </div>
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={onView}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={onDownload}>
                                    <Download className="h-4 w-4 mr-2" />
                                    Download
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="text-red-600"
                                    onClick={() => setDeleteDialogOpen(true)}
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Document
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground w-full justify-between">
                            <span className="flex items-center gap-1" title="Extracted Requirements">
                                <Sparkles className="h-3 w-3" />
                                {document.extractedCount || 0} requirements
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {document.uploadedAt && formatDistanceToNow(document.uploadedAt, { addSuffix: true })}
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Document?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove the document from your project. Requirements that were extracted
                            from this document will remain but lose their source reference.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={onDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export function DocumentsList({ canUpload = false }: DocumentsListProps) {
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
    const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
    const [documents, setDocuments] = useState<Document[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const queryClient = useQueryClient();

    const loadDocuments = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await getDocumentsAction();
            if (result.success && result.documents) {
                setDocuments(result.documents.map(d => ({
                    id: d.id,
                    name: d.name,
                    type: d.type,
                    uploadedAt: d.uploadedAt ? new Date(d.uploadedAt) : new Date(),
                    extractedCount: d.extractedCount || 0,
                    fileSize: d.fileSize,
                    status: "processed" as const,
                })));
            } else if (result.error) {
                toast.error(result.error);
            }
        } catch (error) {
            console.error("Failed to load documents", error);
            toast.error("Failed to load documents");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDocuments();
    }, [loadDocuments]);

    const handleView = (docId: string) => {
        setSelectedDocumentId(docId);
        setDetailsDialogOpen(true);
    };

    const handleDownload = async (docId: string) => {
        try {
            // Use API proxy route to avoid internal Docker hostname issues with presigned URLs
            const downloadUrl = `/api/documents/${docId}/download`;

            // Create a temporary link and click it to trigger download
            const link = document.createElement("a");
            link.href = downloadUrl;
            link.download = ""; // Browser will use Content-Disposition filename
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast.success("Download started");
        } catch (error) {
            console.error("Download error:", error);
            toast.error("Failed to download document");
        }
    };

    const handleDelete = async (docId: string) => {
        try {
            const result = await deleteDocumentAction(docId);
            if (result.success) {
                toast.success("Document deleted");
                loadDocuments();
            } else {
                toast.error(result.error || "Failed to delete document");
            }
        } catch (error) {
            toast.error("Failed to delete document");
        }
    };

    return (
        <div className="space-y-4 pt-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-semibold text-foreground/90">Documents</h2>
                    <p className="text-muted-foreground text-sm">
                        Manage your source documents
                    </p>
                </div>
                {canUpload && (documents.length > 0 || isLoading) && (
                    <Button onClick={() => setUploadDialogOpen(true)} className="gap-2">
                        <Upload className="h-4 w-4" />
                        Upload Document
                    </Button>
                )}
            </div>

            {/* Documents Grid or Empty State */}
            {isLoading ? (
                <SuperCheckLoading className="h-[200px]" />
            ) : documents.length === 0 ? (
                <EmptyDocumentsState onUpload={() => setUploadDialogOpen(true)} />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {documents.map((doc) => (
                        <DocumentCard
                            key={doc.id}
                            document={doc}
                            onView={() => handleView(doc.id)}
                            onDelete={() => handleDelete(doc.id)}
                            onDownload={() => handleDownload(doc.id)}
                        />
                    ))}
                </div>
            )}

            <UploadDocumentDialog
                open={uploadDialogOpen}
                onOpenChange={(open) => {
                    setUploadDialogOpen(open);
                    if (!open) loadDocuments();
                }}
                onComplete={() => {
                    // Invalidate requirements React Query cache to show newly created requirements
                    queryClient.invalidateQueries({ queryKey: ["requirements"], refetchType: "all" });
                }}
            />

            <DocumentDetailsDialog
                documentId={selectedDocumentId}
                open={detailsDialogOpen}
                onOpenChange={setDetailsDialogOpen}
                onDownload={() => selectedDocumentId && handleDownload(selectedDocumentId)}
            />
        </div>
    );
}
