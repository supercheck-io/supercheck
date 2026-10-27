"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ColumnDef, Table as TableType } from "@tanstack/react-table";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { AdminListToolbar } from "@/components/admin/admin-list-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DateCell } from "@/components/ui/table-cells";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { UserCell } from "@/components/ui/user-cell";
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
  TooltipProvider,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import {
  Trash2,
  MoreHorizontal,
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
  createdByImage?: string | null;
}

interface CreatedToken {
  id: string;
  name: string;
  key: string;
  start: string;
  expiresAt: string | null;
  createdAt: string;
}

const TOKEN_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
  { value: "disabled", label: "Disabled" },
];

function getTokenStatus(token: CliToken): {
  value: string;
  label: string;
  tone: TableBadgeTone;
} {
  if (token.expiresAt) {
    const remaining = new Date(token.expiresAt).getTime() - Date.now();
    if (remaining <= 0) return { value: "expired", label: "Expired", tone: "danger" };
    const days = Math.ceil(remaining / 86_400_000);
    if (token.enabled && days <= 7) {
      return { value: "expiring", label: `Expires in ${days}d`, tone: "warning" };
    }
  }
  return token.enabled
    ? { value: "active", label: "Active", tone: "success" }
    : { value: "disabled", label: "Disabled", tone: "slate" };
}

export function CliTokensTable() {
  const [tokens, setTokens] = useState<CliToken[]>([]);
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
        if (errorData.error === "Insufficient permissions") {
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
        if (errorData.error === "Insufficient permissions") {
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

  const columns = useMemo<ColumnDef<CliToken>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Name" />
        ),
        cell: ({ row }) => (
          <div className="flex h-8 items-center gap-2">
            <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{row.original.name}</span>
          </div>
        ),
      },
      {
        accessorKey: "start",
        header: "Token",
        cell: ({ row }) => (
          <code className="rounded-sm bg-muted/60 px-2 py-1 font-mono text-xs dark:bg-muted">
            {row.original.start}
          </code>
        ),
        enableSorting: false,
      },
      {
        id: "status",
        accessorFn: (token) => getTokenStatus(token).value,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const status = getTokenStatus(row.original);
          return (
            <TableBadge tone={status.tone} compact>
              {status.label}
            </TableBadge>
          );
        },
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => <DateCell value={row.original.createdAt} />,
      },
      {
        accessorKey: "expiresAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Expires" />
        ),
        cell: ({ row }) => (
          <DateCell value={row.original.expiresAt} empty="No expiry" />
        ),
      },
      {
        accessorKey: "createdByName",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created by" />
        ),
        cell: ({ row }) => (
          <UserCell
            name={row.original.createdByName}
            image={row.original.createdByImage}
            emptyLabel="Unknown"
            className="max-w-[180px]"
          />
        ),
      },
      {
        accessorKey: "lastRequest",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Last used" />
        ),
        cell: ({ row }) => <DateCell value={row.original.lastRequest} />,
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const token = row.original;
          const busy = Boolean(operationLoadingStates[token.id]);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Open actions for ${token.name}`}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => handleToggleEnabled(token.id, token.enabled)}
                >
                  {token.enabled ? (
                    <Ban className="mr-2 h-3.5 w-3.5" />
                  ) : (
                    <CheckCircle className="mr-2 h-3.5 w-3.5" />
                  )}
                  {token.enabled ? "Disable token" : "Enable token"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => handleDelete(token.id)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete token
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    // The handlers only touch state setters and `loadTokens`, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [operationLoadingStates],
  );

  const Toolbar = useCallback(
    ({ table }: { table: TableType<CliToken> }) => (
      <AdminListToolbar
        table={table}
        searchPlaceholder="Search tokens..."
        facets={[{ columnId: "status", title: "Status", options: TOKEN_STATUS_OPTIONS }]}
      />
    ),
    [],
  );

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
            {isLoading && tokens.length === 0 ? (
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
              <AdminDataTable
                columns={columns}
                data={tokens}
                toolbar={Toolbar}
                itemName="tokens"
                meta={{ globalFilterColumns: ["name", "start", "createdByName"] }}
              />
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
