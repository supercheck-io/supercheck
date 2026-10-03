"use client";

import { useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrganizations } from "@/hooks/use-organizations";
import { useAppConfig } from "@/hooks/use-app-config";
import { reloadOrganization } from "@/lib/organization-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function OrganizationSwitcher() {
  const { data: organizations, activeOrganization, isPending, isError, refetch } = useOrganizations();
  const { isCloudHosted, isDemoMode } = useAppConfig();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function mutate(url: string, body: { name: string } | { organizationId: string }) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to change organization");
      // Server components and every tenant cache must use the new session together.
      reloadOrganization();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change organization");
      pending.current = false;
      setBusy(false);
    }
  }

  if (isError) {
    return <Button variant="outline" size="sm" onClick={() => void refetch()}>Retry organizations</Button>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-0 max-w-full" disabled={isPending || busy} aria-label="Select organization">
            {busy || isPending ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Building2 className="size-4 shrink-0" />}
            <span className="truncate group-data-[collapsible=icon]:hidden">{activeOrganization?.name ?? "Organizations"}</span>
            <ChevronsUpDown className="size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          <div className="max-h-64 overflow-y-auto">
            {organizations?.map(org => (
              <DropdownMenuItem key={org.id} disabled={busy} onSelect={() => {
                if (!org.isActive) void mutate("/api/organizations/switch", { organizationId: org.id });
              }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{org.name}</p>
                  {isCloudHosted && <p className="text-xs text-muted-foreground">{org.subscriptionPlan === "plus" ? "Plus" : org.subscriptionPlan === "pro" ? "Pro" : "No subscription"}</p>}
                </div>
                {org.isActive && <Check className="size-4" aria-label="Current organization" />}
              </DropdownMenuItem>
            ))}
          </div>
          {!isDemoMode && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreating(true)}><Plus className="size-4" />Create organization</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={creating} onOpenChange={open => { if (!busy) setCreating(open); }}>
        <DialogContent>
          <form onSubmit={event => {
            event.preventDefault();
            void mutate("/api/organizations", { name: name.trim() });
          }} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
              <DialogDescription>
                {isCloudHosted ? "Each organization needs its own cloud subscription. Creating an organization does not start a subscription or share another organization's allowances." : "Organize a separate team and its projects on your infrastructure."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="organization-name">Organization name</Label>
              <Input id="organization-name" value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={50} disabled={busy} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? "Creating…" : "Create organization"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
