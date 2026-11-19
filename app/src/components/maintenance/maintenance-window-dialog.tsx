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
import { MONITORS_QUERY_KEY } from "@/hooks/use-monitors";
import { MAINTENANCE_QUERY_KEY, type MaintenanceWindowItem } from "@/hooks/use-maintenance-windows";
import { dstNote, formatDuration, formatWindowRange, previewWindow, timeZoneOptions } from "./format";

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

const targetIds = (window: MaintenanceWindowItem | undefined, type: "monitor" | "service") =>
  window?.targets.filter((target) => target.type === type).map((target) => target.id) ?? [];

/**
 * Schedule a maintenance window, or edit one when `window` is given: monitors keep running while alerts,
 * incidents and paging are muted.
 */
export function MaintenanceWindowDialog({
  open,
  onOpenChange,
  defaults,
  window: editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: MaintenanceDefaults;
  window?: MaintenanceWindowItem;
}) {
  const queryClient = useQueryClient();
  const { projectId, currentProject } = useProjectContext();
  const isEdit = Boolean(editing);
  // The API refuses schedule changes to a one-off window in progress (end or extend it instead),
  // and a window posted to a status page must stay one-off.
  // Also true once a scheduled one-off has started while the dialog was open (the row object is not refreshed).
  const scheduleLocked = editing?.recurrence === "once"
    && (editing.state === "active" || (editing.occurrenceStartsAt !== null && Date.parse(editing.occurrenceStartsAt) <= Date.now()));
  const repeatLocked = scheduleLocked || Boolean(editing?.statusPageIncidentIds.length);
  const canPostPublicly = !isEdit && Boolean(currentProject?.userRole && checkRolePermissionsClient(currentProject.userRole, { status_page: ["update"] }));
  const start = nextHour();
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [scope, setScope] = useState<Scope>(editing?.scope ?? (defaults?.serviceId ? "services" : "monitors"));
  const [monitorIds, setMonitorIds] = useState<string[]>(editing ? targetIds(editing, "monitor") : defaults?.monitorId ? [defaults.monitorId] : []);
  const [serviceIds, setServiceIds] = useState<string[]>(editing ? targetIds(editing, "service") : defaults?.serviceId ? [defaults.serviceId] : []);
  const [startsOn, setStartsOn] = useState(editing?.startsOn ?? start.date);
  const [localStartTime, setLocalStartTime] = useState(editing?.localStartTime.slice(0, 5) ?? start.time);
  const [durationMinutes, setDurationMinutes] = useState(String(editing?.durationMinutes ?? 60));
  const [timezone, setTimezone] = useState(() => editing?.timezone ?? localZone());
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const [recurrence, setRecurrence] = useState<Recurrence>(editing?.recurrence ?? "once");
  const [weekdays, setWeekdays] = useState<number[]>(editing?.weekdays ?? []);
  const [monthDay, setMonthDay] = useState(String(editing?.monthDay ?? 1));
  const [endsOn, setEndsOn] = useState(editing?.endsOn ?? "");
  const [publish, setPublish] = useState(false);
  const [statusPageId, setStatusPageId] = useState<string | null>(null);
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [notify, setNotify] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  // The status page controls show only for a one-off; hidden, they neither block nor post.
  const posting = canPostPublicly && publish && recurrence === "once";

  // Also loaded for a whole-project window, so the preview can count what it mutes.
  const monitors = useAllMonitors(open && scope !== "services");
  const services = useQuery({ queryKey: ["sre-services", "picker", projectId], queryFn: () => getSreServices(), enabled: open && scope === "services" && Boolean(projectId), staleTime: 60_000 });
  const statusPages = useStatusPages({ enabled: open && publish });
  const pageDetail = useStatusPageDetail(open && publish ? statusPageId : null);
  const monitorItems = monitors.data ?? [];
  const serviceItems = (services.data?.services ?? []).filter((s) => s.status === "active" || serviceIds.includes(s.id));
  const selectedCount = scope === "monitors" ? monitorIds.length : serviceIds.length;
  const zones = timeZoneOptions(timezone);
  const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));
  const targetsChanged = !editing || scope !== editing.scope
    || !sameIds(monitorIds, targetIds(editing, "monitor")) || !sameIds(serviceIds, targetIds(editing, "service"));
  const preview = previewWindow({
    recurrence, timezone, localStartTime, durationMinutes: Number(durationMinutes), startsOn, endsOn: endsOn || null,
    weekdays: recurrence === "weekly" ? weekdays : null, monthDay: recurrence === "monthly" ? Number(monthDay) : null,
  });

  const dst = preview ? dstNote(preview.startsAt, preview.endsAt, timezone) : null;

  const submit = async () => {
    if (pending) return;
    setFieldErrors({});
    setPending(true);
    const schedule = scheduleLocked
      ? {}
      : {
          ...(repeatLocked ? {} : { recurrence }),
          timezone: timezone.trim(),
          localStartTime,
          durationMinutes: Number(durationMinutes),
          startsOn,
          endsOn: recurrence !== "once" && endsOn ? endsOn : null,
          weekdays: recurrence === "weekly" ? weekdays : null,
          monthDay: recurrence === "monthly" ? Number(monthDay) : null,
        };
    try {
      const response = await fetch(editing ? `/api/maintenance-windows/${editing.id}` : "/api/maintenance-windows", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        // An edit sends no status page fields (the update API does not take them) and, when locked, no schedule keys at all.
        body: JSON.stringify(editing ? {
          title: title.trim(),
          description: description.trim() || null,
          // Unchanged targets are not resent: a since-deleted monitor among them would make the server refuse the whole edit.
          ...(targetsChanged ? { scope, targets: { serviceIds: scope === "services" ? serviceIds : [], monitorIds: scope === "monitors" ? monitorIds : [] } } : {}),
          ...schedule,
        } : {
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
          statusPages: posting && statusPageId ? [{ statusPageId, componentIds }] : [],
          notifySubscribers: notify,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string>; warning?: string };
      if (!response.ok) {
        setFieldErrors(body.fieldErrors ?? {});
        toast.error(body.error ?? (editing ? "Could not save the maintenance window" : "Could not schedule maintenance"));
        return;
      }
      if (editing) toast.success("Maintenance window updated");
      else if (body.warning === "status_page_failed") toast.warning("Maintenance scheduled, but posting it to the status page failed");
      else toast.success("Maintenance scheduled");
      await queryClient.invalidateQueries({ queryKey: [...MAINTENANCE_QUERY_KEY, projectId] });
      // The monitors list carries the inMaintenance badge.
      await queryClient.invalidateQueries({ queryKey: MONITORS_QUERY_KEY });
      onOpenChange(false);
    } catch {
      toast.error("Could not reach the server. Your draft is kept; try again.");
    } finally {
      setPending(false);
    }
  };

  const fieldError = (key: string) => (fieldErrors[key] ? <p className="text-xs text-destructive" id={`mw-${key}-error`}>{fieldErrors[key]}</p> : null);
  // The first unmet requirement, shown beside the disabled button so it never sits greyed out without a reason.
  const blocker = !title.trim()
    ? "Add a title."
    : scope !== "project" && selectedCount === 0
      ? `Choose at least one ${scope === "monitors" ? "monitor" : "service"}.`
      : recurrence === "weekly" && weekdays.length === 0
        ? "Pick at least one day of the week."
        : posting && !statusPageId
          ? "Choose a status page, or turn off Show on a status page."
          : posting && componentIds.length === 0
            ? "Choose at least one status page component."
            : null;
  const invalid = blocker !== null;
  const names = (ids: string[], items: Array<{ id: string; name: string }>) => {
    const known = ids.map((id) => items.find((item) => item.id === id)?.name ?? "Unknown");
    return known.length > 4 ? `${known.slice(0, 4).join(", ")} and ${known.length - 4} more` : known.join(", ");
  };
  const muted =
    scope === "project"
      ? monitors.data ? `All ${monitorItems.length} monitor${monitorItems.length === 1 ? "" : "s"} in this project` : "Every monitor in this project"
      : selectedCount === 0
        ? null
        : scope === "monitors"
          ? names(monitorIds, monitorItems)
          : `${names(serviceIds, serviceItems)}, with every monitor mapped to them`;

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !pending) && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit maintenance" : "Schedule maintenance"}</DialogTitle>
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
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
              <Input id="mw-date" type="date" value={startsOn} disabled={scheduleLocked} onChange={(e) => setStartsOn(e.target.value)} aria-describedby={fieldErrors.startsOn ? "mw-startsOn-error" : undefined} />
              {fieldError("startsOn")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mw-time">Start time</Label>
              <Input id="mw-time" type="time" value={localStartTime} disabled={scheduleLocked} onChange={(e) => setLocalStartTime(e.target.value)} />
              {fieldError("localStartTime")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mw-duration">Duration (minutes)</Label>
              <Input id="mw-duration" type="number" min={5} max={10080} step={5} value={durationMinutes} disabled={scheduleLocked} onChange={(e) => setDurationMinutes(e.target.value)} aria-describedby={fieldErrors.durationMinutes ? "mw-durationMinutes-error" : undefined} />
              {fieldError("durationMinutes")}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mw-timezone">Time zone</Label>
            <Popover open={zonePickerOpen} onOpenChange={setZonePickerOpen}>
              <PopoverTrigger asChild>
                <Button id="mw-timezone" type="button" variant="outline" role="combobox" aria-expanded={zonePickerOpen} disabled={scheduleLocked} className="w-full justify-between font-normal" aria-describedby={fieldErrors.timezone ? "mw-timezone-error" : undefined}>
                  <span className="truncate">{timezone}</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search time zones" />
                  <CommandList>
                    <CommandEmpty>No time zone found</CommandEmpty>
                    <CommandGroup>
                      {zones.map((zone) => (
                        <CommandItem key={zone} value={zone} onSelect={() => { setTimezone(zone); setZonePickerOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${zone === timezone ? "opacity-100" : "opacity-0"}`} aria-hidden />
                          {zone}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {fieldError("timezone")}
          </div>
          {preview && (
            <p className="text-xs text-muted-foreground" data-testid="mw-preview-time">
              {recurrence === "once" ? "Runs" : "First window"} {formatWindowRange(preview.startsAt, preview.endsAt, timezone)} ({timezone}), {formatDuration(Number(durationMinutes))}.
              {scheduleLocked && " In progress: end or extend it from the table to change its times."}
              {dst && <span data-testid="mw-dst-note"> {dst}</span>}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="mw-repeat">Repeats</Label>
            <Select value={recurrence} onValueChange={(value) => setRecurrence(value as Recurrence)} disabled={repeatLocked}>
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
          {muted && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="mw-mute-preview">
              <p className="font-medium">Alerts muted for</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {muted}
                {posting && componentIds.length > 0 ? ", plus every monitor on the chosen status page components" : ""}.
              </p>
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
        <DialogFooter className="gap-2 sm:items-center">
          {blocker && !pending && <p id="mw-blocker" className="mr-auto text-xs text-muted-foreground">{blocker}</p>}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending || invalid} aria-describedby={blocker ? "mw-blocker" : undefined}>
            {pending ? (<><Loader2 className="h-4 w-4 animate-spin" />{isEdit ? "Saving..." : "Scheduling..."}</>) : isEdit ? "Save changes" : "Schedule maintenance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
