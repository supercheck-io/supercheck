"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { registerPrivateAgent, type PrivateAgentListItem } from "@/actions/private-agents";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PrivateAgentFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (agent: PrivateAgentListItem) => void;
};

type FieldErrors = Record<string, string[] | undefined>;

function firstError(fieldErrors: FieldErrors | undefined, field: string) {
  return fieldErrors?.[field]?.[0] ?? null;
}

export function PrivateAgentFormDialog({ open, onOpenChange, onSaved }: PrivateAgentFormDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [networkLabel, setNetworkLabel] = useState("");
  const [projectScoped, setProjectScoped] = useState(true);
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      const result = await registerPrivateAgent({ name, region, networkLabel, projectScoped });

      if (!result.success) {
        setFieldErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }

      onSaved(result.agent);
      setRegistrationToken(result.registrationToken ?? null);
      toast.success(result.message);
    });
  };

  const copyToken = async () => {
    if (!registrationToken) return;
    await navigator.clipboard.writeText(registrationToken);
    toast.success("Registration token copied");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl min-w-2xl gap-3 overflow-y-auto p-5">
        <DialogHeader>
          <DialogTitle>Register Private Agent</DialogTitle>
          <DialogDescription>
            Private Agents proxy read-only connector requests to private networks. The token is shown once.
          </DialogDescription>
        </DialogHeader>

        {registrationToken ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              Copy this token now. It is stored only as a hash and cannot be recovered later.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="private-agent-token">Registration token</Label>
              <div className="flex gap-2">
                <Input id="private-agent-token" value={registrationToken} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copyToken}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              Start the agent with this token in its environment. Connector execution remains read-only and policy-gated by SuperCheck.
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="private-agent-name">Agent name *</Label>
                <Input
                  id="private-agent-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="prod-vpc-agent"
                  aria-invalid={Boolean(firstError(fieldErrors, "name"))}
                />
                {firstError(fieldErrors, "name") && (
                  <p className="text-xs text-destructive">{firstError(fieldErrors, "name")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="private-agent-region">Region</Label>
                <Input
                  id="private-agent-region"
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                  placeholder="us-east-1"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="private-agent-network">Network label</Label>
                <Input
                  id="private-agent-network"
                  value={networkLabel}
                  onChange={(event) => setNetworkLabel(event.target.value)}
                  placeholder="prod-vpc"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 md:col-span-2">
                <Checkbox checked={projectScoped} onCheckedChange={(checked) => setProjectScoped(checked === true)} />
                <span className="space-y-1 text-sm">
                  <span className="block font-medium">Scope this agent to the current project</span>
                  <span className="block text-muted-foreground">
                    Recommended. Organization-wide agents can serve all projects in the organization.
                  </span>
                </span>
              </label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Register agent
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
