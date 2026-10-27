"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableBadge } from "@/components/ui/table-badge";
import { ListPagination } from "@/components/admin/list-pagination";
import { repaginate, useFitPageSize } from "@/hooks/use-fit-page-size";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import {
  Trash2,
  AlertTriangle,
  Key,
  Loader2,
  CheckCircle,
  Ban,
  Plus,
  Copy,
  Eye,
  EyeOff,
  Check,
  CalendarIcon,
  Clock,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";

interface CliToken {
  id: string;
  name: string;
  start: string;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  lastRequest: string | null;
  createdByName: string | null;
}

interface CreatedToken {
  id: string;
  name: string;
  key: string;
  start: string;
  expiresAt: string | null;
  createdAt: string;
}

export function CliTokensTable() {
  const [tokens, setTokens] = useState<CliToken[]>([]);
  const { bodyRef, pageSize, setPageSize } = useFitPageSize();
  const [page, setPage] = useState({ index: 0, size: pageSize });
  // Auto-fit changes the size outside the table, so carry the page across here.
  if (page.size !== pageSize) {
    setPage({
      index: repaginate(page.index, page.size, pageSize, tokens.length),
      size: pageSize,
    });
  }
  const pageCount = Math.max(1, Math.ceil(tokens.length / pageSize));
  const pageIndex = Math.min(page.index, pageCount - 1);
  const pageTokens = tokens.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<string | null>(null);
  const [operationLoadingStates, setOperationLoadingStates] = useState<{
    [id: string]: "toggle" | "delete" | null;
  }>({});

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState<Date>();
  const [isCreating, setIsCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/cli-tokens");

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(
            "Access denied. You don\'t have permission to view CLI tokens."
          );
        }
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setTokens(data.tokens || []);
    } catch (err) {
      console.error("Failed to load CLI tokens:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load CLI tokens. Please refresh the page."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const resetCreateForm = () => {
    setCreateName("");
    setHasExpiry(false);
    setExpiryDate(undefined);
    setCreatedToken(null);
    setShowKey(false);
    setCopied(false);
  };

  const handleCreateClose = () => {
    setCreateOpen(false);
    setTimeout(() => {
      if (createdToken) loadTokens();
      resetCreateForm();
    }, 200);
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("Token copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful) {
        setCopied(true);
        toast.success("Token copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error("Copy command failed");
      }
    } catch (error) {
      console.error("Copy failed:", error);
      toast.error("Failed to copy to clipboard. Please copy manually.");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createName.trim()) {
      toast.error("Please enter a name for the token");
      return;
    }

    setIsCreating(true);

    try {
      const payload: Record<string, unknown> = {
        name: createName.trim(),
      };
      if (hasExpiry && expiryDate) {
        const endOfDay = new Date(expiryDate);
        endOfDay.setHours(23, 59, 59, 999);
        const expiresIn = Math.floor(
          (endOfDay.getTime() - Date.now()) / 1000
        );
        if (expiresIn < 3600) {
          toast.error("Expiry must be at least 1 hour in the future");
          return;
        }
        payload.expiresIn = expiresIn;
      }

      const response = await fetch("/api/cli-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.details && Array.isArray(data.details)) {
          const errorMessages = data.details
            .map(
              (err: Record<string, unknown>) => `${err.field}: ${err.message}`
            )
            .join(", ");
          throw new Error(`Validation failed: ${errorMessages}`);
        }
        throw new Error(data.error || "Failed to create CLI token");
      }

      setCreatedToken(data.token);
      toast.success("CLI token created successfully");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to create CLI token: ${message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = (id: string) => {
    setTokenToDelete(id);
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!tokenToDelete) return;

    try {
      setOperationLoadingStates((prev) => ({
        ...prev,
        [tokenToDelete]: "delete",
      }));

      const response = await fetch(`/api/cli-tokens/${tokenToDelete}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Provide user-friendly error messages based on the error type
        if (response.status === 403 || errorData.error === "Insufficient permissions") {
          throw new Error("You don't have permission to delete CLI tokens. Please contact a Project Admin or Organization Admin.");
        }
        throw new Error(errorData.error || "Failed to delete CLI token");
      }

      toast.success("CLI token deleted successfully");
      loadTokens();
    } catch (error) {
      console.error("Error deleting CLI token:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete CLI token"
      );
    } finally {
      setShowDeleteDialog(false);
      setOperationLoadingStates((prev) => ({
        ...prev,
        [tokenToDelete]: null,
      }));
      setTokenToDelete(null);
    }
  };

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    try {
      setOperationLoadingStates((prev) => ({ ...prev, [id]: "toggle" }));

      const response = await fetch(`/api/cli-tokens/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Provide user-friendly error messages based on the error type
        if (response.status === 403 || errorData.error === "Insufficient permissions") {
          throw new Error("You don't have permission to update CLI tokens. Please contact a Project Admin or Organization Admin.");
        }
        throw new Error(errorData.error || "Failed to update CLI token");
      }

      toast.success(
        `CLI token ${!currentEnabled ? "enabled" : "disabled"} successfully`
      );
      loadTokens();
    } catch (error) {
      console.error("Error updating CLI token:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update CLI token"
      );
    } finally {
      setOperationLoadingStates((prev) => ({ ...prev, [id]: null }));
    }
  };

  const getExpiryStatus = (expiresAt: string | null) => {
    if (!expiresAt) return null;

    const now = new Date();
    const expiry = new Date(expiresAt);
    const daysUntilExpiry = Math.ceil(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilExpiry < 0) {
      return {
        status: "expired",
        text: "Expired",
        className: "bg-red-500/10 text-red-500",
      };
    } else if (daysUntilExpiry <= 7) {
      return {
        status: "expiring",
        text: `Expires in ${daysUntilExpiry}d`,
        className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      };
    }

    return null;
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load tokens</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={loadTokens} className="ml-4 shrink-0">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="space-y-4">
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Manage API tokens for CLI and CI/CD access.{" "}
                <a
                  href="https://supercheck.io/docs/cli/installation"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  CLI documentation
                </a>
              </p>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Token
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  {createdToken ? (
                    <>
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          </div>
                          Token Created Successfully
                        </DialogTitle>
                        <DialogDescription>
                          Make sure to copy your token now. You won&apos;t be able to see it again.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 pt-2">
                        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                              Name
                            </p>
                            <p className="text-sm font-medium truncate">
                              {createdToken.name}
                            </p>
                          </div>
                          <div className="border-t pt-3">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                              Token
                            </p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 relative">
                                <Input
                                  value={createdToken.key}
                                  type={showKey ? "text" : "password"}
                                  readOnly
                                  className="pr-16 font-mono text-xs bg-background"
                                />
                                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => setShowKey(!showKey)}
                                  >
                                    {showKey ? (
                                      <EyeOff className="h-3.5 w-3.5" />
                                    ) : (
                                      <Eye className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() =>
                                      copyToClipboard(createdToken.key)
                                    }
                                  >
                                    {copied ? (
                                      <Check className="h-3.5 w-3.5 text-green-500" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground border-t pt-3">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {createdToken.createdAt
                                ? format(new Date(createdToken.createdAt), "PPP")
                                : "-"}
                            </span>
                            {createdToken.expiresAt && (
                              <>
                                <span className="text-border">{String.fromCharCode(183)}</span>
                                <span>
                                  Expires{" "}
                                  {format(new Date(createdToken.expiresAt), "PPP")}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Quick Start
                          </p>
                          <div className="space-y-1.5">
                            <code className="block text-xs font-mono text-muted-foreground bg-background rounded-md px-2.5 py-1.5 border">
                              export SUPERCHECK_TOKEN=
                              {createdToken.key?.substring(0, 16) || "..."}...
                            </code>
                            <code className="block text-xs font-mono text-muted-foreground bg-background rounded-md px-2.5 py-1.5 border">
                              supercheck login --token $SUPERCHECK_TOKEN
                            </code>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            This token will only be displayed once. Please copy it and store it securely.
                          </p>
                        </div>

                        <Button
                          onClick={handleCreateClose}
                          className="w-full"
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Done
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <DialogHeader>
                        <DialogTitle>Create CLI Token</DialogTitle>
                        <DialogDescription>
                          Generate a new token for CLI access and CI/CD integration.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleCreate} className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <Label htmlFor="cli-token-name">Token Name</Label>
                          <Input
                            id="cli-token-name"
                            placeholder="e.g., CI/CD Pipeline, Local Dev"
                            value={createName}
                            onChange={(e) => setCreateName(e.target.value)}
                            maxLength={100}
                            autoFocus
                          />
                          <p className="text-xs text-muted-foreground">
                            Choose a descriptive name to identify this token&apos;s purpose.
                          </p>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <Label htmlFor="cli-token-expiry" className="text-sm">
                                Expiration Date
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                Optionally set when this token should expire.
                              </p>
                            </div>
                            <Switch
                              id="cli-token-expiry"
                              checked={hasExpiry}
                              onCheckedChange={setHasExpiry}
                            />
                          </div>
                          {hasExpiry && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full justify-start font-normal",
                                    !expiryDate && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {expiryDate
                                    ? format(expiryDate, "PPP")
                                    : "Select expiration date"}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-auto p-0"
                                align="start"
                              >
                                <Calendar
                                  mode="single"
                                  selected={expiryDate}
                                  onSelect={setExpiryDate}
                                  disabled={(date) => date < new Date()}
                                  initialFocus
                                  captionLayout="dropdown"
                                />
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>

                        <div className="flex gap-3 pt-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleCreateClose}
                            className="flex-1"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={isCreating || !createName.trim()}
                            className="flex-1"
                          >
                            {isCreating ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Creating...
                              </>
                            ) : (
                              "Create Token"
                            )}
                          </Button>
                        </div>
                      </form>
                    </>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-6">
                <SupercheckLoading size="sm" message="Loading tokens..." />
              </div>
            ) : tokens.length === 0 ? (
              <DashboardEmptyState
                className="min-h-[240px]"
                title="No CLI tokens yet"
                description="Use Create Token to start with CLI and CI/CD access."
                icon={<Key className="h-10 w-10" />}
              />
            ) : (
              <>
                <div className="relative max-w-full overflow-x-auto rounded-t-lg border">
                  <Table className="w-full min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Created by</TableHead>
                        <TableHead>Last used</TableHead>
                        <TableHead className="w-[100px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody ref={bodyRef}>
                      {pageTokens.map((token) => {
                        const expiryStatus = getExpiryStatus(token.expiresAt);
                        const isExpired = expiryStatus?.status === "expired";
                        return (
                          <TableRow key={token.id}>
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2">
                                <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="font-medium">{token.name}</span>
                                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                                  {token.start}
                                </code>
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {token.enabled && !isExpired && (
                                  <TableBadge tone="success" compact>
                                    Active
                                  </TableBadge>
                                )}
                                {!token.enabled && (
                                  <TableBadge tone="slate" compact>
                                    Disabled
                                  </TableBadge>
                                )}
                                {expiryStatus && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                      expiryStatus.className
                                    )}
                                  >
                                    {expiryStatus.text}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5 text-muted-foreground">
                              {format(new Date(token.createdAt), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell className="py-2.5 text-muted-foreground">
                              {token.expiresAt
                                ? format(new Date(token.expiresAt), "MMM d, yyyy")
                                : "No expiry"}
                            </TableCell>
                            <TableCell className="py-2.5 text-muted-foreground">
                              {token.createdByName || "-"}
                            </TableCell>
                            <TableCell className="py-2.5 text-muted-foreground">
                              {token.lastRequest
                                ? format(new Date(token.lastRequest), "MMM d, yyyy")
                                : "Never"}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-8 w-8 ${
                                token.enabled
                                  ? "text-green-600 bg-green-500/10 hover:bg-green-500/20 hover:text-green-700 dark:text-green-400 dark:bg-green-500/10 dark:hover:bg-green-500/20 dark:hover:text-green-300"
                                  : "text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground"
                              }`}
                              aria-label={`${token.enabled ? "Disable" : "Enable"} token ${token.name}`}
                              onClick={() =>
                                handleToggleEnabled(token.id, token.enabled)
                              }
                              disabled={
                                operationLoadingStates[token.id] === "toggle"
                              }
                            >
                              {operationLoadingStates[token.id] === "toggle" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : token.enabled ? (
                                <CheckCircle className="h-4 w-4" />
                              ) : (
                                <Ban className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {token.enabled ? "Disable token" : "Enable token"}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 bg-red-500/10 hover:bg-red-500/20 hover:text-red-700 dark:text-red-400 dark:bg-red-500/10 dark:hover:bg-red-500/20 dark:hover:text-red-300"
                              aria-label={`Delete token ${token.name}`}
                              onClick={() => handleDelete(token.id)}
                              disabled={
                                operationLoadingStates[token.id] === "delete"
                              }
                            >
                              {operationLoadingStates[token.id] === "delete" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            Delete token
                          </TooltipContent>
                        </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <ListPagination
                  total={tokens.length}
                  itemName="tokens"
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageCount={pageCount}
                  onPageChange={(index) => setPage({ index, size: pageSize })}
                  onPageSizeChange={setPageSize}
                />
              </>
            )}
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                Delete CLI Token
              </AlertDialogTitle>
              <AlertDialogDescription className="pt-2">
                Are you sure you want to delete this CLI token? Any CLI sessions
                or CI/CD pipelines using this token will immediately lose access.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="pt-2">
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={
                  tokenToDelete
                    ? operationLoadingStates[tokenToDelete] === "delete"
                    : false
                }
                className="bg-red-600 hover:bg-red-700"
              >
                {tokenToDelete &&
                  operationLoadingStates[tokenToDelete] === "delete" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  "Delete Token"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
