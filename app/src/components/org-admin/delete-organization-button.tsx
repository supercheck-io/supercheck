"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "@/utils/auth-client";
import { clearProjectsCache } from "@/hooks/use-project-context";

interface DeleteOrganizationButtonProps {
  organizationId: string;
  organizationName: string;
}

type DeletionInfo = { graceDays: number; emailAvailable: boolean; hasSubscription: boolean; pending: boolean };

/**
 * Owner-only: asks to delete the organization after the name is typed. Never immediate: the organization turns
 * read-only for a grace window and the owner can cancel until it ends.
 */
export function DeleteOrganizationButton({ organizationId, organizationName }: DeleteOrganizationButtonProps) {
  const [open, setOpen] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [info, setInfo] = useState<DeletionInfo | null>(null);
  const [infoFailed, setInfoFailed] = useState(false);
  const [infoAttempt, setInfoAttempt] = useState(0);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [requested, setRequested] = useState<{ purgeAfter: string | null } | null>(null);
  // Compare trimmed values and never accept an empty confirmation.
  const expectedName = organizationName.trim();
  const confirmed = typedName.trim() !== "" && typedName.trim() === expectedName;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInfoFailed(false);
    fetch(`/api/organizations/${organizationId}/deletion`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.deletion) setInfo(data.deletion);
        else setInfoFailed(true);
      })
      .catch(() => !cancelled && setInfoFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, organizationId, infoAttempt]);

  // The grace window is only known once the server answered: confirming is disabled until then, so the dialog never promises a window the server may not give.
  const graceDays = info?.graceDays ?? 14;
  // Without a mail server nothing is sent, so the confirmation is shown here instead.
  const emailed = info ? info.emailAvailable : true;

  const handleRequest = async () => {
    if (!confirmed || !info || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/organizations/${organizationId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typedName.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!data) {
        toast.error("No response from the server. Reload the page to see whether the deletion was requested.");
      } else if (data.code === "REAUTH_REQUIRED") {
        setNeedsReauth(true);
      } else if (!data.success) {
        toast.error(data.error || "Failed to request organization deletion");
      } else if (data.status === "already") {
        // Another owner or tab already scheduled it: no email went out now, so do not claim one did.
        toast.info("This organization is already scheduled for deletion. Use the banner to cancel it.");
        window.location.reload();
      } else {
        setRequested({ purgeAfter: data.purgeAfter ?? null });
        clearProjectsCache();
      }
    } catch {
      toast.error("Lost contact with the server. Reload the page to see whether the deletion was requested.");
    }
    setIsDeleting(false);
  };

  const handleReauth = async () => {
    await signOut().catch(() => undefined);
    // Signing in again starts a fresh session on the default organization, so come back through the organization switch page.
    window.location.replace(new URL(`/sign-in?next=${encodeURIComponent(`/switch-organization?org=${organizationId}`)}`, window.location.origin));
  };

  const close = (next: boolean) => {
    if (isDeleting) return;
    setOpen(next);
    // The page shows the pending banner once the request succeeded.
    if (!next && requested) window.location.reload();
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
        onClick={() => {
          setTypedName("");
          setNeedsReauth(false);
          setRequested(null);
          setOpen(true);
        }}
        title="Delete organization"
        aria-label="Delete organization"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              {requested ? "Deletion requested" : "Delete organization"}
            </DialogTitle>
            <DialogDescription>
              {requested
                ? `${organizationName} is scheduled for deletion.`
                : graceDays > 0
                  ? `Schedule ${organizationName} for deletion. You can cancel during the ${graceDays}-day window.`
                  : `Delete ${organizationName}. There is no cancellation window.`}
            </DialogDescription>
          </DialogHeader>
          {requested ? (
            <Alert>
              <AlertTitle>{emailed ? "We emailed the organization owners" : "Confirmed. No email was sent"}</AlertTitle>
              <AlertDescription>
                {graceDays === 0
                  ? "Everything is being deleted now."
                  : `${requested.purgeAfter ? `Everything is deleted permanently on ${new Date(requested.purgeAfter).toLocaleDateString()} unless you cancel. ` : ""}${
                      emailed ? "Reminders follow before the deletion. " : "This server cannot send email, so keep this date. "
                    }Cancel any time before then from the banner at the top of the app.`}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>What happens next</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc pl-5">
                    <li>
                      {graceDays > 0
                        ? `The organization is read-only for ${graceDays} days: members can view and export, nothing runs, no changes or invites`
                        : "The organization is deleted straight away"}
                    </li>
                    <li>All projects, tests, jobs, runs, monitors, status pages and stored reports are then deleted permanently</li>
                    {info?.hasSubscription && <li>The subscription stops renewing and ends at the end of the paid period</li>}
                    <li>{emailed ? "All owners are emailed" : "No email is sent (this server has no mail setup)"}</li>
                  </ul>
                </AlertDescription>
              </Alert>
              {needsReauth && (
                <Alert>
                  <AlertTitle>Sign in again to continue</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>For your safety, sign in again, then reopen this dialog and confirm within a few minutes.</p>
                    <Button size="sm" variant="outline" onClick={() => void handleReauth()}>
                      Sign in again
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRequest();
                }}
              >
                <Label htmlFor="delete-org-confirm">Type the organization name to confirm</Label>
                <Input
                  id="delete-org-confirm"
                  value={typedName}
                  onChange={(event) => setTypedName(event.target.value)}
                  placeholder={expectedName}
                  autoComplete="off"
                  disabled={isDeleting}
                />
              </form>
              {infoFailed && (
                <p role="alert" className="text-sm text-destructive">
                  Could not load the deletion settings, so the cancellation window is unknown.{" "}
                  <button type="button" className="underline" onClick={() => setInfoAttempt((n) => n + 1)}>Retry</button>
                </p>
              )}
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)} disabled={isDeleting}>
              {requested ? "Close" : "Cancel"}
            </Button>
            {!requested && (
              <Button variant="destructive" onClick={handleRequest} disabled={!confirmed || !info || isDeleting}>
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Request deletion
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
