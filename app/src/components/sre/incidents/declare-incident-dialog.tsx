"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createManualSreIncident, type CreateManualSreIncidentResult, type SreIncidentListItem } from "@/actions/sre-incidents";
import { getSreServices } from "@/actions/sre-services";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAllMonitors } from "@/hooks/use-all-monitors";
import { useProjectContext } from "@/hooks/use-project-context";
import { useSreIncidentAssignees } from "@/hooks/use-sre";
import { useStatusPageDetail, useStatusPages } from "@/hooks/use-status-pages";
import { checkRolePermissionsClient } from "@/lib/rbac/permissions-client";
import { getSreIncidentAnalyticsQueryKey, getSreIncidentsQueryKey } from "@/lib/sre/query-keys";

const NONE = "none";
type Impact = "none" | "minor" | "major" | "critical";

export type DeclareIncidentDefaults = { serviceId?: string; monitorId?: string };

/**
 * The one "declare an incident" form: incidents page, Quick Create / Cmd+K (?new=1), service and monitor pages.
 * Only title and severity are needed; everything else is optional and editable later.
 */
export function DeclareIncidentDialog({
  open,
  onOpenChange,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: DeclareIncidentDefaults;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { projectId, currentProject } = useProjectContext();
  const canPostPublicly = Boolean(currentProject?.userRole && checkRolePermissionsClient(currentProject.userRole, { status_page: ["update"] }));

  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<SreIncidentListItem["severity"]>("sev3");
  const [summary, setSummary] = useState("");
  const [serviceId, setServiceId] = useState(defaults?.serviceId ?? NONE);
  const [monitorIds, setMonitorIds] = useState<string[]>(defaults?.monitorId ? [defaults.monitorId] : []);
  const [commanderId, setCommanderId] = useState(NONE);
  const [postPublicly, setPostPublicly] = useState(false);
  const [statusPageId, setStatusPageId] = useState<string | null>(null);
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [impact, setImpact] = useState<Impact>("minor");
  const [message, setMessage] = useState("");
  const [notifySubscribers, setNotifySubscribers] = useState(false);
  const [monitorPickerOpen, setMonitorPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const services = useQuery({
    queryKey: ["sre-services", "picker", projectId],
    queryFn: () => getSreServices(),
    enabled: open && Boolean(projectId),
    staleTime: 60_000,
  });
  // Every monitor, not one page: the API caps a page at 100.
  const monitors = useAllMonitors(open);
  const assignees = useSreIncidentAssignees(open);
  const statusPages = useStatusPages({ enabled: open && postPublicly });
  const pageDetail = useStatusPageDetail(open && postPublicly ? statusPageId : null);

  const monitorItems = monitors.data ?? [];
  // The server caps services and monitors together at 50 (lib/sre/incident-resources.ts); the service counts as one.
  const monitorLimit = 50 - (serviceId === NONE ? 0 : 1);
  const monitorName = (id: string) => monitorItems.find((item) => item.id === id)?.name ?? "Monitor";

  const reset = () => {
    setTitle("");
    setSeverity("sev3");
    setSummary("");
    setCommanderId(NONE);
    setPostPublicly(false);
    setStatusPageId(null);
    setComponentIds([]);
    setImpact("minor");
    setMessage("");
    setNotifySubscribers(false);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const submit = () => {
    if (isPending) return;
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Incident title is required");
      return;
    }
    if (postPublicly && (!statusPageId || componentIds.length === 0)) {
      toast.error("Pick a status page and at least one component, or turn off the public post");
      return;
    }
    startTransition(async () => {
      const result = await createManualSreIncident({
        title: trimmed,
        severity,
        summary: summary.trim() || null,
        primaryServiceId: serviceId === NONE ? null : serviceId,
        affected: monitorIds.length ? { monitorIds } : undefined,
        commanderUserId: commanderId === NONE ? null : commanderId,
        statusPage:
          postPublicly && statusPageId
            ? { statusPageId, componentIds, impact, message: message.trim() || undefined, notifySubscribers }
            : null,
      }).catch((): CreateManualSreIncidentResult => ({ success: false, error: "Could not reach the server. Your draft is kept; try again." }));
      if (!result.success) {
        toast.error(result.fieldErrors?.title?.[0] ?? result.error);
        return;
      }
      if (result.warning === "status_page_failed") {
        toast.warning(`${result.message}, but the status page post failed`, {
          description: "Post it again with Post to status page on the incident.",
        });
      } else {
        toast.success(result.message);
      }
      close();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getSreIncidentsQueryKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: getSreIncidentAnalyticsQueryKey(projectId) }),
      ]);
      router.push(`/incidents/${result.incident.id}`);
    });
  };

  return (
    // While declaring, the dialog stays open: a stale success must not close a newer draft.
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !isPending && close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Declare incident</DialogTitle>
          <DialogDescription>
            For problems no alert caught, such as a customer report. Failing monitors and jobs open incidents automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="manual-incident-title">Title</Label>
            <Input id="manual-incident-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Checkout API failures" maxLength={500} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="manual-incident-severity">Severity</Label>
              <Select value={severity} onValueChange={(value) => setSeverity(value as SreIncidentListItem["severity"])}>
                <SelectTrigger id="manual-incident-severity"><SelectValue placeholder="Select severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sev1">SEV1 - Critical</SelectItem>
                  <SelectItem value="sev2">SEV2 - High</SelectItem>
                  <SelectItem value="sev3">SEV3 - Medium</SelectItem>
                  <SelectItem value="sev4">SEV4 - Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-incident-service">Service</Label>
              <Select value={serviceId} onValueChange={(value) => { setServiceId(value); if (value !== NONE) setMonitorIds((ids) => ids.slice(0, 49)); }}>
                <SelectTrigger id="manual-incident-service"><SelectValue placeholder="No service" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No service</SelectItem>
                  {(services.data?.services ?? [])
                    .filter((service) => service.status === "active" || service.id === serviceId)
                    .map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-incident-monitors">Affected monitors</Label>
            <Popover open={monitorPickerOpen} onOpenChange={setMonitorPickerOpen}>
              <PopoverTrigger asChild>
                <Button id="manual-incident-monitors" type="button" variant="outline" role="combobox" aria-expanded={monitorPickerOpen} className="w-full justify-between font-normal">
                  <span className="truncate">
                    {monitorIds.length === 0 ? "None" : monitorIds.length === 1 ? monitorName(monitorIds[0]!) : `${monitorIds.length} monitors`}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search monitors" />
                  <CommandList>
                    <CommandEmpty>{monitors.isLoading ? "Loading monitors..." : monitors.error ? "Monitors could not be loaded" : "No monitors found"}</CommandEmpty>
                    <CommandGroup>
                      {monitorItems.map((monitor) => {
                        const selected = monitorIds.includes(monitor.id);
                        return (
                          <CommandItem
                            key={monitor.id}
                            value={`${monitor.name} ${monitor.id}`}
                            onSelect={() => setMonitorIds((ids) => (selected ? ids.filter((id) => id !== monitor.id) : ids.length < monitorLimit ? [...ids, monitor.id] : ids))}
                          >
                            <Check className={`mr-2 h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden />
                            <span className="truncate">{monitor.name}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">Their next alerts join this incident instead of opening new ones.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-incident-commander">Commander</Label>
            <Select value={commanderId} onValueChange={setCommanderId}>
              <SelectTrigger id="manual-incident-commander"><SelectValue placeholder="No commander" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No commander</SelectItem>
                {(assignees.data?.assignees ?? []).map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-incident-summary">Initial notes</Label>
            <Textarea id="manual-incident-summary" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="What is known so far?" rows={3} maxLength={4000} />
          </div>
          {canPostPublicly && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="manual-incident-public">Post to a status page</Label>
                <Switch id="manual-incident-public" checked={postPublicly} onCheckedChange={setPostPublicly} />
              </div>
              {postPublicly && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="manual-incident-status-page">Status page</Label>
                    <Select value={statusPageId ?? undefined} onValueChange={(value) => { setStatusPageId(value); setComponentIds([]); }}>
                      <SelectTrigger id="manual-incident-status-page">
                        <SelectValue placeholder={statusPages.loading ? "Loading status pages..." : "Select a status page"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(statusPages.statusPages ?? []).map((page: { id: string; name: string }) => <SelectItem key={page.id} value={page.id}>{page.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {!statusPages.loading && (statusPages.statusPages ?? []).length === 0 && (
                      <p className="text-xs text-muted-foreground">This project has no status pages.</p>
                    )}
                  </div>
                  {statusPageId && (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Affected components</legend>
                      {pageDetail.isLoading && <p className="text-xs text-muted-foreground">Loading components...</p>}
                      {pageDetail.error && <p className="text-xs text-destructive">Components could not be loaded.</p>}
                      {!pageDetail.isLoading && !pageDetail.error && pageDetail.components.length === 0 && (
                        <p className="text-xs text-muted-foreground">This status page has no components.</p>
                      )}
                      {pageDetail.components.map((component) => (
                        <label key={component.id} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={componentIds.includes(component.id)}
                            onCheckedChange={(checked) =>
                              setComponentIds((ids) => (checked === true ? [...ids, component.id] : ids.filter((id) => id !== component.id)))
                            }
                          />
                          <span className="truncate">{component.name}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="manual-incident-impact">Impact</Label>
                    <Select value={impact} onValueChange={(value) => setImpact(value as Impact)}>
                      <SelectTrigger id="manual-incident-impact"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="minor">Minor</SelectItem>
                        <SelectItem value="major">Major</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-incident-message">Public message</Label>
                    <Textarea id="manual-incident-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="We are investigating reports of errors." rows={2} maxLength={10000} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="manual-incident-notify">Notify subscribers</Label>
                    <Switch id="manual-incident-notify" checked={notifySubscribers} onCheckedChange={setNotifySubscribers} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={isPending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={isPending || !title.trim()}>
            {isPending ? (<><Loader2 className="h-4 w-4 animate-spin" />Declaring...</>) : "Declare incident"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
