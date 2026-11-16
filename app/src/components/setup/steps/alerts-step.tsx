"use client";

import { useCallback, useEffect, useState } from "react";
import { Hash, Mail, MessageCircle, Send, Users, Webhook, type LucideIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TableBadge } from "@/components/ui/table-badge";
import { WEBHOOK_PRESETS, getWebhookPreset } from "@/lib/notification-providers/webhook-presets";
import { SETUP_LIMITS } from "@/lib/setup/draft-schema";
import { checkSetupProject, postJson, responseError, type StepProps } from "./step-types";

type ChannelType = "email" | "slack" | "teams" | "discord" | "telegram" | "webhook";

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "password" | "email" | "url";
  placeholder?: string;
  help?: string;
}

const CHANNELS: Array<{ type: ChannelType; label: string; icon: LucideIcon; summary: string; fields: FieldDef[] }> = [
  { type: "email", label: "Email", icon: Mail, summary: "Comma-separated addresses", fields: [{ key: "emails", label: "Email addresses", type: "text" }] },
  {
    type: "slack",
    label: "Slack",
    icon: Hash,
    summary: "Incoming webhook",
    fields: [{ key: "webhookUrl", label: "Incoming webhook URL", type: "url", placeholder: "https://hooks.slack.com/services/...", help: "Create it in Slack under Apps, Incoming Webhooks, and pick the channel there." }],
  },
  { type: "teams", label: "Microsoft Teams", icon: Users, summary: "Incoming webhook", fields: [{ key: "teamsWebhookUrl", label: "Incoming webhook URL", type: "url" }] },
  { type: "discord", label: "Discord", icon: MessageCircle, summary: "Webhook URL", fields: [{ key: "discordWebhookUrl", label: "Webhook URL", type: "url" }] },
  {
    type: "telegram",
    label: "Telegram",
    icon: Send,
    summary: "Bot token and chat",
    fields: [
      { key: "botToken", label: "Bot token", type: "password" },
      { key: "chatId", label: "Chat ID" },
    ],
  },
  { type: "webhook", label: "Webhook", icon: Webhook, summary: "Any HTTPS endpoint", fields: [{ key: "url", label: "Endpoint URL", type: "url", help: "Must be public HTTPS." }] },
];

interface SavedProvider {
  id: string;
  name: string;
  type: string;
}

const REPEAT_OPTIONS = [5, 10, 15, 30, 60];

/**
 * A name that tells channels apart in the list. Only email addresses: webhook URLs (including the host, which some
 * services make secret per tenant), tokens and chat ids never go into a name, because names are shown to viewers.
 */
export function channelName(channel: { type: ChannelType; label: string }, values: Record<string, string>): string {
  const detail = channel.type === "email" ? values.emails?.split(",")[0]?.trim() || "setup" : "setup";
  return `${channel.label} – ${detail}`.slice(0, 100);
}

function ChannelForm({
  projectId,
  channel,
  defaultEmail,
  onSaved,
}: {
  projectId: string;
  channel: (typeof CHANNELS)[number];
  defaultEmail?: string | null;
  onSaved: (provider: SavedProvider) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(channel.type === "email" && defaultEmail ? { emails: defaultEmail } : {});
  const [presetId, setPresetId] = useState("custom");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const config = useCallback((): Record<string, unknown> => {
    const base: Record<string, unknown> = { ...values };
    if (channel.type === "webhook") {
      const preset = getWebhookPreset(presetId);
      if (preset) Object.assign(base, { preset: preset.id, ...preset.config });
    }
    return base;
  }, [values, channel.type, presetId]);

  const missing = channel.fields.some((field) => !values[field.key]?.trim());

  const test = async () => {
    setBusy("test");
    try {
      const res = await postJson<{ success?: boolean; message?: string }>("/api/notification-providers/test", { type: channel.type, config: config() });
      setResult(res.ok && res.data.success !== false ? { ok: true, text: res.data.message ?? "Test sent." } : { ok: false, text: responseError(res.data, "The test failed.") });
    } catch {
      setResult({ ok: false, text: "The test failed. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    const name = channelName(channel, values);
    try {
      // The route also refuses a switched project (expected-project header); this covers the rest.
      const changed = await checkSetupProject(projectId);
      if (changed) {
        setResult({ ok: false, text: changed });
        return;
      }
      const res = await postJson<{ id?: string; name?: string; type?: string }>("/api/notification-providers", { name, type: channel.type, config: { ...config(), name } }, projectId);
      if (res.ok && res.data.id) {
        onSaved({ id: res.data.id, name, type: channel.type });
      } else {
        setResult({ ok: false, text: responseError(res.data, "Could not save the channel.") });
      }
    } catch {
      setResult({ ok: false, text: "Could not save the channel. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid={`setup-channel-form-${channel.type}`}>
      {channel.type === "webhook" ? (
        <div className="space-y-1.5">
          <Label htmlFor="setup-webhook-preset">Service</Label>
          <Select value={presetId} onValueChange={setPresetId}>
            <SelectTrigger id="setup-webhook-preset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEBHOOK_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{getWebhookPreset(presetId)?.summary}</p>
        </div>
      ) : null}
      {channel.fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`setup-${channel.type}-${field.key}`}>{field.label}</Label>
          <Input
            id={`setup-${channel.type}-${field.key}`}
            type={field.type ?? "text"}
            autoComplete="off"
            placeholder={field.key === "url" ? getWebhookPreset(presetId)?.endpointPlaceholder : field.placeholder}
            value={values[field.key] ?? ""}
            onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
          />
          {field.help ? <p className="text-xs text-muted-foreground">{field.help}</p> : null}
        </div>
      ))}
      {result ? <Alert variant={result.ok ? "success" : "error"}>{result.text}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={missing || busy !== null} onClick={test}>
          Send test
        </Button>
        <Button type="button" size="sm" disabled={missing || busy !== null} onClick={save}>
          Save channel
        </Button>
      </div>
    </div>
  );
}

export function AlertsStep({ response, draft, patchDraft, features, permissions, readOnly, userEmail }: StepProps) {
  const providerIds = draft.alerts?.providerIds ?? [];
  const [saved, setSaved] = useState<SavedProvider[]>([]);
  const [open, setOpen] = useState<ChannelType | null>(providerIds.length === 0 && userEmail ? "email" : null);
  const [loadError, setLoadError] = useState(false);

  const idsKey = providerIds.join(",");
  useEffect(() => {
    if (!idsKey) return;
    const wanted = idsKey.split(",");
    let cancelled = false;
    fetch("/api/notification-providers")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((rows: SavedProvider[]) => !cancelled && setSaved(rows.filter((row) => wanted.includes(row.id))))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const onSaved = (provider: SavedProvider) => {
    setSaved((list) => [...list, provider]);
    patchDraft((d) => ({ ...d, alerts: { ...d.alerts, providerIds: [...(d.alerts?.providerIds ?? []), provider.id].slice(0, 10) } }));
    setOpen(null);
  };

  const channelsFull = providerIds.length >= SETUP_LIMITS.maxChannels;
  const repeat = draft.alerts?.repeatUntilAck;
  const setRepeat = (next: { enabled: boolean; repeatMinutes: number }) =>
    patchDraft((d) => ({ ...d, alerts: { providerIds: [], ...d.alerts, repeatUntilAck: next } }));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Pick where we tell you when something breaks. Each channel is saved right away, the same way as on the Notifications page.</p>

      {saved.length > 0 || providerIds.length > 0 ? (
        <section aria-label="Already saved channels" className="space-y-2">
          <h3 className="text-sm font-semibold">Already set up</h3>
          <ul className="flex flex-wrap gap-2">
            {saved.map((provider) => (
              <li key={provider.id}>
                <TableBadge tone="success">{provider.name}</TableBadge>
              </li>
            ))}
            {loadError ? <li className="text-xs text-muted-foreground">{providerIds.length} saved channel(s)</li> : null}
          </ul>
        </section>
      ) : null}

      {channelsFull ? (
        <Alert variant="info">You have {SETUP_LIMITS.maxChannels} channels, the most setup keeps. Add more later from Notifications.</Alert>
      ) : !readOnly && permissions.canCreateNotification ? (
        <section aria-label="Add a channel" className="space-y-3">
          <div role="group" aria-label="Channel types" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CHANNELS.map((channel) => (
              <Button
                key={channel.type}
                type="button"
                variant="outline"
                aria-pressed={open === channel.type}
                className="h-auto justify-start gap-3 whitespace-normal px-3 py-2 text-left"
                onClick={() => setOpen(open === channel.type ? null : channel.type)}
              >
                <channel.icon aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{channel.label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{channel.summary}</span>
                </span>
              </Button>
            ))}
          </div>
          {open ? <ChannelForm key={open} projectId={response.projectId} channel={CHANNELS.find((c) => c.type === open)!} defaultEmail={userEmail} onSaved={onSaved} /> : null}
        </section>
      ) : !permissions.canCreateNotification ? (
        <Alert variant="info">You do not have permission to add channels in this project. Ask a project admin.</Alert>
      ) : (
        <Alert variant="info">Setup is running somewhere else, so channels cannot be added from this tab.</Alert>
      )}

      {features.repeatUntilAck ? (
        <section className="rounded-lg border p-4" data-testid="setup-card-repeat">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="setup-repeat" className="text-sm font-semibold">
                Repeat until acknowledged
              </Label>
              <p className="text-xs text-muted-foreground">
                {permissions.canUpdateProject
                  ? "Remind again while an incident is unacknowledged, using the project's notification policy. If the policy has no channels yet, setup adds the ones you saved here."
                  : "Ask a project admin. Only project admins can turn on repeat reminders."}
              </p>
            </div>
            <Switch
              id="setup-repeat"
              checked={Boolean(repeat?.enabled)}
              disabled={readOnly || !permissions.canUpdateProject}
              onCheckedChange={(enabled) => setRepeat({ enabled, repeatMinutes: repeat?.repeatMinutes ?? 15 })}
            />
          </div>
          {repeat?.enabled ? (
            <div className="mt-3 flex items-center gap-2">
              <Label htmlFor="setup-repeat-every" className="text-xs">
                Repeat every
              </Label>
              <Select
                value={String(repeat.repeatMinutes)}
                disabled={readOnly || !permissions.canUpdateProject}
                onValueChange={(value) => setRepeat({ enabled: true, repeatMinutes: Number(value) })}
              >
                <SelectTrigger id="setup-repeat-every" className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_OPTIONS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {minutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </section>
      ) : null}

      {features.warningAlerts ? (
        <section className="rounded-lg border p-4" data-testid="setup-card-warnings">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="setup-warnings" className="text-sm font-semibold">
                Also alert on warnings
              </Label>
              <p className="text-xs text-muted-foreground">
                Late heartbeats, slow AI replies and changed MCP tools notify your channels without opening an incident. Applies to the heartbeat, AI and MCP monitors you create here.
              </p>
            </div>
            <Switch
              id="setup-warnings"
              checked={Boolean(draft.alerts?.warnings)}
              disabled={readOnly}
              onCheckedChange={(warnings) => patchDraft((d) => ({ ...d, alerts: { providerIds: [], ...d.alerts, warnings } }))}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
