"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Shield,
  Plus,
  Copy,
  Eye,
  EyeOff,
  Check,
  CalendarIcon,
  Terminal,
  Clock,
  User,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
        throw new Error(errorData.error || "Failed to revoke CLI token");
      }

      toast.success("CLI token revoked successfully");
      loadTokens();
    } catch (error) {
      console.error("Error revoking CLI token:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to revoke CLI token"
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
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Terminal className="h-5 w-5 text-muted-foreground" />
            CLI Tokens
          </CardTitle>
          <CardDescription>
            Create and manage CLI tokens for the Supercheck CLI and programmatic API access
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        {/* CLI Tokens Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-muted-foreground" />
                  CLI Tokens
                </CardTitle>
                <CardDescription className="text-sm">
                  Create and manage CLI tokens for the Supercheck CLI and
                  programmatic API access. Tokens are project-scoped with{" "}
                  <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono">
                    sck_live_
                  </code>{" "}
                  prefix.
                </CardDescription>
              </div>
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1.5" />
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
                            <p className="text-sm font-medium">
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
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Loading tokens...</p>
              </div>
            ) : tokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                  <Key className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium mb-1">
                  No CLI tokens yet
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Create your first CLI token to enable Supercheck CLI access and CI/CD integration.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tokens.map((token) => {
                  const expiryStatus = getExpiryStatus(token.expiresAt);
                  const isExpired = expiryStatus?.status === "expired";
                  return (
                    <div
                      key={token.id}
                      className={cn(
                        "group flex items-center justify-between p-4 border rounded-lg transition-colors",
                        isExpired
                          ? "bg-red-500/5 border-red-500/20"
                          : "hover:bg-muted/50"
                      )}
                    >
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-sm">
                            {token.name}
                          </span>
                          <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                            {token.start}
                          </code>
                          {token.enabled && !isExpired && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-500/10 text-green-600 dark:text-green-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                              Active
                            </span>
                          )}
                          {!token.enabled && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
                              Disabled
                            </span>
                          )}
                          {expiryStatus && (
                            <span
                              className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium",
                                expiryStatus.className
                              )}
                            >
                              {expiryStatus.text}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-x-4 gap-y-1 text-xs text-muted-foreground flex-wrap ml-[26px]">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(token.createdAt), "MMM d, yyyy")}
                          </span>
                          <span>
                            {token.expiresAt
                              ? `Expires ${format(new Date(token.expiresAt), "MMM d, yyyy")}`
                              : "No expiry"}
                          </span>
                          {token.createdByName && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {token.createdByName}
                            </span>
                          )}
                          {token.lastRequest && (
                            <span>
                              Last used {format(new Date(token.lastRequest), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-4 shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
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
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <Ban className="h-4 w-4 text-muted-foreground" />
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
                              className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
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
                            Revoke token
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Usage & Security Info */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-muted/30 border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                CLI Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-1.5">
                <code className="block text-xs font-mono text-muted-foreground bg-background rounded-md px-3 py-2 border">
                  npm install -g @supercheck/cli
                </code>
                <code className="block text-xs font-mono text-muted-foreground bg-background rounded-md px-3 py-2 border">
                  supercheck login --token &lt;your-token&gt;
                </code>
                <code className="block text-xs font-mono text-muted-foreground bg-background rounded-md px-3 py-2 border">
                  supercheck whoami
                </code>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-muted/30 border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                Security Best Practices
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                  Use environment variables in CI/CD (never hardcode tokens)
                </li>
                <li className="flex items-start gap-2">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                  Set expiration dates for temporary access
                </li>
                <li className="flex items-start gap-2">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                  Rotate tokens regularly and revoke unused ones
                </li>
                <li className="flex items-start gap-2">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
                  Max 20 CLI tokens per project
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                Revoke CLI Token
              </AlertDialogTitle>
              <AlertDialogDescription className="pt-2">
                Are you sure you want to revoke this CLI token? Any CLI sessions
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
                    Revoking...
                  </>
                ) : (
                  "Revoke Token"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
