"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon, Copy, Eye, EyeOff, Check, Plus } from "lucide-react";
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
  createdAt?: string; // Added createdAt for compact display
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
          <Button size="sm" className="h-8">
            <Plus className="h-3 w-3 mr-1" />
            Create Key
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-base">API Key Created</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Card>
              <CardContent className="p-3">
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground">
                      Name
                    </Label>
                    <div className="text-sm font-mono mt-0.5">
                      {createdKey.name}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mt-2">
                      API Key
                    </Label>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 relative">
                        <Input
                          value={createdKey.key}
                          type={showKey ? "text" : "password"}
                          readOnly
                          className="pr-16 font-mono text-xs"
                        />
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => setShowKey(!showKey)}
                          >
                            {showKey ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => copyToClipboard(createdKey.key)}
                          >
                            {copied ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Compact row for created/expiry date */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <span>
                      Created:{" "}
                      {createdKey.createdAt
                        ? format(new Date(createdKey.createdAt), "PPP")
                        : "-"}
                    </span>
                    {createdKey.expiresAt && <span className="mx-1">·</span>}
                    {createdKey.expiresAt && (
                      <span>
                        Expires: {format(new Date(createdKey.expiresAt), "PPP")}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            {/* Quick Reference - compact, muted bg, rounded, small font */}
            <div className="bg-muted border border-border rounded px-3 py-2">
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Quick Reference
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">
                  Authorization: Bearer{" "}
                  {createdKey.key?.substring(0, 20) || "..."}...
                </span>
              </div>
              <div className="text-xs text-blue-600 mt-1">
                Copy this key now - it won&apos;t be shown again
              </div>
            </div>
            <Button onClick={handleDialogClose} className="w-full text-sm">
              <Check className="h-4 w-4 mr-1" /> I have copied the key
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="h-3 w-3 mr-1" />
          Create Key
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader className="pb-3">
          <DialogTitle className="text-lg">Create API Key</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g., Production CI/CD"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="expiry" className="text-sm">
                Set expiration date{" "}
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  Optional
                </span>
              </Label>
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
                      "w-full justify-center text-center font-normal h-9",
                      !expiryDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {expiryDate ? format(expiryDate, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="center">
                  <Calendar
                    mode="single"
                    selected={expiryDate}
                    onSelect={setExpiryDate}
                    disabled={(date) => date < new Date()}
                    initialFocus
                    captionLayout="dropdown"
                    className="rounded-md border shadow-sm"
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating} className="flex-1">
              {isCreating ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
