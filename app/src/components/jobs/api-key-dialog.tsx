"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import {
  CalendarIcon,
  Copy,
  Eye,
  EyeOff,
  Check,
  Plus,
  CheckCircle,
  Loader2,
  Info,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ApiKeyDialogProps {
  jobId: string;
  onApiKeyCreated?: () => void;
}

interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  expiresAt?: string;
  createdAt?: string;
}

export function ApiKeyDialog({ jobId, onApiKeyCreated }: ApiKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState<Date>();
  const [isCreating, setIsCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const resetForm = () => {
    setName("");
    setHasExpiry(false);
    setExpiryDate(undefined);
    setCreatedKey(null);
    setShowKey(false);
    setCopied(false);
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => {
      if (createdKey && onApiKeyCreated) onApiKeyCreated();
      resetForm();
    }, 200);
  };

  const handleDialogClose = () => {
    setOpen(false);
    setTimeout(() => {
      if (createdKey && onApiKeyCreated) onApiKeyCreated();
      resetForm();
    }, 200);
  };

  const copyToClipboard = async (text: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("API key copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      // Fallback for older browsers
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
        toast.success("API key copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error("Copy command failed");
      }
    } catch (error) {
      console.error("Copy failed:", error);
      toast.error("Failed to copy to clipboard. Please copy manually.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter a name for the API key");
      return;
    }

    setIsCreating(true);

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
      };
      if (hasExpiry && expiryDate) {
        // Set expiry to end of selected day (23:59:59 local time)
        const endOfDay = new Date(expiryDate);
        endOfDay.setHours(23, 59, 59, 999);
        const expiresIn = Math.floor((endOfDay.getTime() - Date.now()) / 1000);

        if (expiresIn < 60) {
          toast.error("Expiry date must be at least 1 minute in the future");
          return;
        }
        payload.expiresIn = expiresIn;
      }

      const response = await fetch(`/api/jobs/${jobId}/api-keys`, {
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
        throw new Error(data.error || "Failed to create API key");
      }

      // Use data.apiKey for correct property
      setCreatedKey(data.apiKey);

      toast.success("API key created successfully");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to create API key: ${message}`);
    } finally {
      setIsCreating(false);
    }
  };

  if (createdKey) {
    return (
      <Dialog open={open} onOpenChange={handleDialogClose}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1.5" />
            Create Key
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
                <CheckCircle className="h-4 w-4 text-green-500" />
              </div>
              API Key Created Successfully
            </DialogTitle>
            <DialogDescription>
              Make sure to copy your API key now. You won&apos;t be able to see it again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Name
                </p>
                <p className="text-sm font-medium">
                  {createdKey.name}
                </p>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  API Key
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <Input
                      value={createdKey.key}
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
                        onClick={() => copyToClipboard(createdKey.key)}
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
                  {createdKey.createdAt
                    ? format(new Date(createdKey.createdAt), "PPP")
                    : "-"}
                </span>
                {createdKey.expiresAt && (
                  <>
                    <span className="text-border">&middot;</span>
                    <span>
                      Expires {format(new Date(createdKey.expiresAt), "PPP")}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Quick Reference
              </p>
              <code className="block text-xs font-mono text-muted-foreground bg-background rounded-md px-2.5 py-1.5 border">
                Authorization: Bearer {createdKey.key?.substring(0, 20) || "..."}...
              </code>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This key will only be displayed once. Please copy it and store it securely.
              </p>
            </div>

            <Button onClick={handleDialogClose} className="w-full">
              <Check className="h-4 w-4 mr-2" />
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          Create Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Generate a new key for automated job triggering from CI/CD pipelines.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">Key Name</Label>
            <Input
              id="name"
              placeholder="e.g., Production CI/CD"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Choose a descriptive name to identify this key&apos;s purpose.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="expiry" className="text-sm">
                  Expiration Date
                </Label>
                <p className="text-xs text-muted-foreground">
                  Optionally set when this key should expire.
                </p>
              </div>
              <Switch
                id="expiry"
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
                    {expiryDate ? format(expiryDate, "PPP") : "Select expiration date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
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
              onClick={handleClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !name.trim()} className="flex-1">
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Key"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
