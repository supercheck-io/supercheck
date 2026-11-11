"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DeleteProjectDialogProps {
  project: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

/** Owners and admins: soft-deletes a project after its name is typed; it can be restored for 7 days. */
export function DeleteProjectDialog({ project, onOpenChange, onDeleted }: DeleteProjectDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const expected = project?.name.trim() ?? "";
  const confirmed = typedName.trim() !== "" && typedName.trim() === expected;

  const submit = async () => {
    if (!project || !confirmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Failed to delete project");
      } else {
        toast.success("Project deleted. You can restore it for 7 days.");
        setTypedName("");
        onOpenChange(false);
        onDeleted();
      }
    } catch {
      toast.error("Failed to delete project");
    }
    setBusy(false);
  };

  return (
    <Dialog open={!!project} onOpenChange={(next) => { if (!busy) { setTypedName(""); onOpenChange(next); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete project
          </DialogTitle>
          <DialogDescription>Delete {project?.name}. You can restore it for 7 days.</DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertTitle>What happens</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc pl-5">
              <li>The project disappears at once and its jobs and monitors stop running</li>
              <li>After 7 days its tests, runs, monitors, status pages and reports are deleted permanently</li>
              <li>An owner or admin can restore it until then</li>
            </ul>
          </AlertDescription>
        </Alert>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Label htmlFor="delete-project-confirm">Type the project name to confirm</Label>
          <Input id="delete-project-confirm" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder={expected} autoComplete="off" disabled={busy} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setTypedName(""); onOpenChange(false); }} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!confirmed || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
