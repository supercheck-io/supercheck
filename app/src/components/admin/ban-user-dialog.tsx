"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { UserX, Loader2, AlertTriangle, ShieldAlert } from "lucide-react";
import { banUserSchema, type BanUserFormData } from "@/lib/validations/user";
import { z } from "zod";

interface BanUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userEmail: string;
  onSuccess: () => void;
}

export function BanUserDialog({
  open,
  onOpenChange,
  userId,
  userName,
  userEmail,
  onSuccess,
}: BanUserDialogProps) {
  const [banReason, setBanReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setBanReason("");
      setValidationError(null);
      setIsDirty(false);
    }
  }, [open]);

  const validateReason = useCallback((reason: string): string | null => {
    try {
      banUserSchema.parse({ reason });
      return null;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return error.errors[0]?.message || "Invalid ban reason";
      }
      return "Invalid ban reason";
    }
  }, []);

  const handleReasonChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setBanReason(value);
      setIsDirty(true);

      // Only show validation errors after user has started typing
      if (isDirty || value.length > 0) {
        setValidationError(validateReason(value));
      }
    },
    [isDirty, validateReason]
  );

  const handleBan = async () => {
    // Validate before submission
    const error = validateReason(banReason);
    if (error) {
      setValidationError(error);
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          action: "ban",
          reason: banReason.trim(),
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`${userName} has been banned successfully`);
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(data.error || "Failed to ban user");
      }
    } catch (error) {
      console.error("Error banning user:", error);
      toast.error("Failed to ban user. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  };

  const characterCount = banReason.length;
  const minChars = 20;
  const maxChars = 500;
  const isValid = !validationError && characterCount >= minChars;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
              <UserX className="h-4 w-4 text-destructive" />
            </div>
            <span>Ban User</span>
          </DialogTitle>
          <DialogDescription className="pt-1.5">
            You are about to ban{" "}
            <strong className="text-foreground">{userName}</strong>{" "}
            <span className="text-muted-foreground">({userEmail})</span>. This
            action will prevent them from accessing the platform.
          </DialogDescription>
        </DialogHeader>

        <Separator className="my-1" />

        <div className="space-y-4 py-2">
          <Alert
            variant="destructive"
            className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20"
          >
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              This action is reversible. The user will be unable to sign in
              until they are unbanned. All their data will be preserved.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="ban-reason" className="text-sm font-medium">
              Ban Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="ban-reason"
              placeholder="Please provide a clear reason for banning this user (minimum 20 characters)..."
              value={banReason}
              onChange={handleReasonChange}
              className={`min-h-[100px] resize-none ${
                validationError && isDirty
                  ? "border-destructive focus-visible:ring-destructive"
                  : ""
              }`}
              maxLength={maxChars}
              disabled={isSubmitting}
              aria-invalid={!!validationError && isDirty}
              aria-describedby="ban-reason-error ban-reason-hint"
            />
            <div className="flex items-center justify-between">
              <div id="ban-reason-error" className="flex-1">
                {validationError && isDirty && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {validationError}
                  </p>
                )}
              </div>
              <p
                id="ban-reason-hint"
                className={`text-xs ${
                  characterCount < minChars
                    ? "text-muted-foreground"
                    : "text-green-600 dark:text-green-400"
                }`}
              >
                {characterCount}/{maxChars} characters
                {characterCount < minChars && ` (min ${minChars})`}
              </p>
            </div>
          </div>
        </div>

        <Separator className="my-1" />

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleBan}
            disabled={isSubmitting || !isValid}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Banning...
              </>
            ) : (
              <>
                <UserX className="mr-2 h-4 w-4" />
                Ban User
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
