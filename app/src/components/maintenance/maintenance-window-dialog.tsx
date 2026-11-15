"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
import { useStatusPageDetail, useStatusPages } from "@/hooks/use-status-pages";
import { checkRolePermissionsClient } from "@/lib/rbac/permissions-client";
import { MAINTENANCE_QUERY_KEY } from "@/hooks/use-maintenance-windows";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Scope = "project" | "services" | "monitors";
type Recurrence = "once" | "daily" | "weekly" | "monthly";

export type MaintenanceDefaults = { monitorId?: string; serviceId?: string };

const pad = (n: number) => String(n).padStart(2, "0");
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
/** The next whole hour in the browser's clock, as the default start. */
function nextHour() {
  const d = new Date(Date.now() + 60 * 60_000);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:00` };
}

/** Schedule a maintenance window: monitors keep running while alerts, incidents and paging are muted. */
export function MaintenanceWindowDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (open: boolean) => void; defaults?: MaintenanceDefaults }) {
  const queryClient = useQueryClient();
  const { projectId, currentProject } = useProjectContext();
  const canPostPublicly = Boolean(currentProject?.userRole && checkRolePermissionsClient(currentProject.userRole, { status_page: ["update"] }));
  const start = nextHour();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<Scope>(defaults?.serviceId ? "services" : "monitors");
  const [monitorIds, setMonitorIds] = useState<string[]>(defaults?.monitorId ? [defaults.monitorId] : []);
  const [serviceIds, setServiceIds] = useState<string[]>(defaults?.serviceId ? [defaults.serviceId] : []);
  const [startsOn, setStartsOn] = useState(start.date);
  const [localStartTime, setLocalStartTime] = useState(start.time);
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [timezone, setTimezone] = useState(localZone);
  const [recurrence, setRecurrence] = useState<Recurrence>("once");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState("1");
  const [endsOn, setEndsOn] = useState("");
  const [publish, setPublish] = useState(false);
  const [statusPageId, setStatusPageId] = useState<string | null>(null);
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [notify, setNotify] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const monitors = useAllMonitors(open && scope === "monitors");
  const services = useQuery({ queryKey: ["sre-services", "picker", projectId], queryFn: getSreServices, enabled: open && scope === "services" && Boolean(projectId), staleTime: 60_000 });
  const statusPages = useStatusPages({ enabled: open && publish });
  const pageDetail = useStatusPageDetail(open && publish ? statusPageId : null);
  const monitorItems = monitors.data ?? [];
  const serviceItems = (services.data?.services ?? []).filter((s) => s.status === "active" || serviceIds.includes(s.id));
  const selectedCount = scope === "monitors" ? monitorIds.length : serviceIds.length;

  const submit = async () => {
    if (pending) return;
    setFieldErrors({});
    setPending(true);
    try {
      const response = await fetch("/api/maintenance-windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          scope,
          targets: { serviceIds: scope === "services" ? serviceIds : [], monitorIds: scope === "monitors" ? monitorIds : [] },
          recurrence,
          timezone: timezone.trim(),
          localStartTime,
          durationMinutes: Number(durationMinutes),
          startsOn,
          endsOn: recurrence !== "once" && endsOn ? endsOn : null,
          weekdays: recurrence === "weekly" ? weekdays : null,
          monthDay: recurrence === "monthly" ? Number(monthDay) : null,
          statusPages: publish && recurrence === "once" && statusPageId ? [{ statusPageId, componentIds }] : [],
          notifySubscribers: notify,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string>; warning?: string };
      if (!response.ok) {
        setFieldErrors(body.fieldErrors ?? {});
        toast.error(body.error ?? "Could not schedule maintenance");
        return;
      }
      if (body.warning === "status_page_failed") toast.warning("Maintenance scheduled, but posting it to the status page failed");
      else toast.success("Maintenance scheduled");
      await queryClient.invalidateQueries({ queryKey: [...MAINTENANCE_QUERY_KEY, projectId] });
      onOpenChange(false);
    } catch {
      toast.error("Could not reach the server. Your draft is kept; try again.");
    } finally {
      setPending(false);
    }
  };

  const fieldError = (key: string) => (fieldErrors[key] ? <p className="text-xs text-destructive" id={`mw-${key}-error`}>{fieldErrors[key]}</p> : null);
  const invalid = !title.trim() || (scope !== "project" && selectedCount === 0) || (recurrence === "weekly" && weekdays.length === 0) || (publish && (!statusPageId || componentIds.length === 0));

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !pending) && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule maintenance</DialogTitle>
          <DialogDescription>Monitors keep running. Alerts, new incidents and reminders are muted, and uptime leaves the window out.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="mw-title">Title</Label>
            <Input id="mw-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Database upgrade" maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mw-scope">Covers</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as Scope)}>
              <SelectTrigger id="mw-scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monitors">Chosen monitors</SelectItem>
                <SelectItem value="services">Chosen services (their monitors, including ones added later)</SelectItem>
                <SelectItem value="project">Every monitor in this project</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope !== "project" && (
            <div className="space-y-2">
              <Label htmlFor="mw-targets">{scope === "monitors" ? "Monitors" : "Services"}</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button id="mw-targets" type="button" variant="outline" role="combobox" aria-expanded={pickerOpen} className="w-full justify-between font-normal">
                    <span className="truncate">{selectedCount === 0 ? "None" : `${selectedCount} selected`}</span>
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={scope === "monitors" ? "Search monitors" : "Search services"} />
                    <CommandList>
                      <CommandEmpty>
                        {(scope === "monitors" ? monitors.isLoading : services.isLoading) ? "Loading..." : (scope === "monitors" ? monitors.error : services.error) ? "Could not be loaded" : "Nothing found"}
                      </CommandEmpty>
                      <CommandGroup>
                        {(scope === "monitors" ? monitorItems : serviceItems).map((item) => {
                          const ids = scope === "monitors" ? monitorIds : serviceIds;
                          const setIds = scope === "monitors" ? setMonitorIds : setServiceIds;
                          const selected = ids.includes(item.id);
                          return (
                            <CommandItem key={item.id} value={`${item.name} ${item.id}`} onSelect={() => setIds((list) => (selected ? list.filter((id) => id !== item.id) : list.length < 500 ? [...list, item.id] : list))}>
                              <Check className={`mr-2 h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden />
                              <span className="truncate">{item.name}</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="mw-date">{recurrence === "once" ? "Date" : "First date"}</Label>
              <Input id="mw-date" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-describedby={fieldErrors.startsOn ? "mw-startsOn-error" : undefined} />
              {fieldError("startsOn")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mw-time">Start time</Label>
              <Input id="mw-time" type="time" value={localStartTime} onChange={(e) => setLocalStartTime(e.target.value)} />
              {fieldError("localStartTime")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mw-duration">Minutes</Label>
              <Input id="mw-duration" type="number" min={5} max={10080} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} aria-describedby={fieldErrors.durationMinutes ? "mw-durationMinutes-error" : undefined} />
              {fieldError("durationMinutes")}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mw-timezone">Time zone</Label>
            <Input id="mw-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/Berlin" aria-describedby={fieldErrors.timezone ? "mw-timezone-error" : undefined} />
            {fieldError("timezone")}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mw-repeat">Repeats</Label>
            <Select value={recurrence} onValueChange={(value) => setRecurrence(value as Recurrence)}>
              <SelectTrigger id="mw-repeat"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Does not repeat</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {recurrence === "weekly" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">On</legend>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((day, index) => (
                  <label key={day} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={weekdays.includes(index)} onCheckedChange={(checked) => setWeekdays((days) => (checked === true ? [...days, index] : days.filter((d) => d !== index)))} />
                    {day}
                  </label>
                ))}
              </div>
              {fieldError("weekdays")}
            </fieldset>
          )}
          {recurrence === "monthly" && (
            <div className="space-y-2">
              <Label htmlFor="mw-monthday">Day of the month</Label>
              <Select value={monthDay} onValueChange={setMonthDay}>
                <SelectTrigger id="mw-monthday"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 28 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)}
                  <SelectItem value="-1">Last day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {recurrence !== "once" && (
            <div className="space-y-2">
              <Label htmlFor="mw-until">Ends on (optional)</Label>
              <Input id="mw-until" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              {fieldError("endsOn")}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="mw-description">Notes</Label>
            <Textarea id="mw-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
          </div>
          {canPostPublicly && recurrence === "once" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="mw-publish">Show on a status page</Label>
                <Switch id="mw-publish" checked={publish} onCheckedChange={setPublish} />
              </div>
              {publish && (
                <>
                  <Select value={statusPageId ?? undefined} onValueChange={(value) => { setStatusPageId(value); setComponentIds([]); }}>
                    <SelectTrigger aria-label="Status page"><SelectValue placeholder={statusPages.loading ? "Loading status pages..." : "Select a status page"} /></SelectTrigger>
                    <SelectContent>
                      {(statusPages.statusPages ?? []).map((page: { id: string; name: string }) => <SelectItem key={page.id} value={page.id}>{page.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {statusPageId && (
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Components</legend>
                      {pageDetail.isLoading && <p className="text-xs text-muted-foreground">Loading components...</p>}
                      {!pageDetail.isLoading && pageDetail.components.length === 0 && <p className="text-xs text-muted-foreground">This status page has no components.</p>}
                      {pageDetail.components.map((component) => (
                        <label key={component.id} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={componentIds.includes(component.id)} onCheckedChange={(checked) => setComponentIds((ids) => (checked === true ? [...ids, component.id] : ids.filter((id) => id !== component.id)))} />
                          <span className="truncate">{component.name}</span>
                        </label>
                      ))}
                      <p className="text-xs text-muted-foreground">Every monitor on these components is muted too.</p>
                    </fieldset>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="mw-notify">Notify subscribers at creation, start and end</Label>
                    <Switch id="mw-notify" checked={notify} onCheckedChange={setNotify} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending || invalid}>
            {pending ? (<><Loader2 className="h-4 w-4 animate-spin" />Scheduling...</>) : "Schedule maintenance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
