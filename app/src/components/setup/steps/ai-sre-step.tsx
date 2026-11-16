"use client";

import { useState } from "react";
import Link from "next/link";
import { Radio } from "lucide-react";

import { createSreConnector, getSreConnectors, validateSreConnector } from "@/actions/sre-connectors";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableBadge } from "@/components/ui/table-badge";
import { getConnectorQueryGuide } from "@/components/sre/connectors/connector-query-guides";
import { SRE_CONNECTOR_CATALOG } from "@/components/sre/connectors/connector-catalog";
import { CopyFromProject } from "./copy-from-project";
import { checkSetupProject, type StepProps } from "./step-types";

type ConnectorType = "github" | "sentry" | "datadog" | "grafana" | "prometheus";

interface FieldDef {
  key: string;
  label: string;
  /** Goes into the credential value; `secret` fields render as passwords. */
  credential: boolean;
  secret?: boolean;
  required?: boolean;
}

/** Same credential shapes as the full connector form (connector-form-dialog.tsx): `secret`, or apiKey + applicationKey. */
const CONNECTORS: Array<{ type: ConnectorType; fields: FieldDef[] }> = [
  { type: "github", fields: [{ key: "endpointUrl", label: "API URL (optional)", credential: false }, { key: "secret", label: "Access token", credential: true, secret: true, required: true }] },
  { type: "sentry", fields: [{ key: "endpointUrl", label: "API URL (optional)", credential: false }, { key: "secret", label: "Auth token", credential: true, secret: true, required: true }] },
  {
    type: "datadog",
    fields: [
      { key: "endpointUrl", label: "API URL (optional)", credential: false },
      { key: "apiKey", label: "API key", credential: true, secret: true, required: true },
      { key: "applicationKey", label: "Application key", credential: true, secret: true, required: true },
    ],
  },
  { type: "grafana", fields: [{ key: "endpointUrl", label: "Grafana URL", credential: false, required: true }, { key: "secret", label: "Service account token (optional)", credential: true, secret: true }] },
  { type: "prometheus", fields: [{ key: "endpointUrl", label: "Prometheus URL", credential: false, required: true }, { key: "secret", label: "Bearer token (optional)", credential: true, secret: true }] },
];

type Outcome = { state: "connected" | "rejected" | "saved"; text: string };

const labelOf = (type: string) => SRE_CONNECTOR_CATALOG.find((c) => c.value === type)?.label ?? type;

function ConnectorForm({ def, projectId, knownIds, onSaved }: { def: (typeof CONNECTORS)[number]; projectId: string; knownIds: string[]; onSaved: (id: string, outcome: Outcome) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placeholder = getConnectorQueryGuide(def.type).endpointPlaceholder;
  const missing = def.fields.some((f) => f.required && !values[f.key]?.trim());

  const save = async () => {
    setBusy(true);
    setError(null);
    // The action writes to the active project, so confirm it is still the setup project.
    const changed = await checkSetupProject(projectId);
    if (changed) {
      setError(changed);
      setBusy(false);
      return;
    }
    const credentialValue = Object.fromEntries(def.fields.filter((f) => f.credential && values[f.key]?.trim()).map((f) => [f.key, values[f.key].trim()]));
    const hasCredential = Object.keys(credentialValue).length > 0;
    try {
      // A save whose answer was lost (network drop) already exists: adopt it instead of creating a duplicate.
      // Prefers one this setup recorded, else the same type and exact name in the project.
      const existing = await getSreConnectors()
        .then((r) => (r.success ? r.connectors.filter((c) => c.type === def.type && c.name === labelOf(def.type) && c.status !== "disabled") : []))
        .catch(() => []);
      const adopted = existing.find((c) => knownIds.includes(c.id)) ?? existing[0];
      // Saved right away (D8): the token never enters the setup draft.
      const created = adopted ? { success: true as const, connector: { id: adopted.id } } : await createSreConnector({
        name: labelOf(def.type),
        type: def.type,
        endpointUrl: values.endpointUrl?.trim() ?? "",
        riskLevel: "low",
        serviceIds: [],
        defaultTimeWindowMinutes: 60,
        outputLimits: { maxRows: 100, maxBytes: 1_048_576, maxSeconds: 10 },
        credential: hasCredential ? { credentialType: "api_key", value: credentialValue } : undefined,
      }, projectId);
      const id = created.success ? created.connector?.id : undefined;
      if (!created.success || !id) {
        setError(created.success ? "The connector was saved but could not be read back." : created.error);
        setBusy(false);
        return;
      }
      setValues({});
      // The id is recorded whatever the test does, so a retry never creates a duplicate connector.
      let outcome: Outcome;
      try {
        const checked = await validateSreConnector({ id }, projectId);
        // The action reports success even when the check failed: only the stored status says the token works.
        outcome =
          checked.success && checked.connector?.lastValidationStatus === "valid"
            ? { state: "connected", text: "Connected" }
            : { state: "rejected", text: `Saved, but the token was rejected. ${checked.success ? checked.message : checked.error} Update it from the connector page.` };
      } catch {
        outcome = { state: "saved", text: "Saved, but could not test it. Test it from the connector page." };
      }
      onSaved(id, outcome);
    } catch {
      setError("Could not save the connector. Try again.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid={`setup-connector-form-${def.type}`}>
      {def.fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`setup-${def.type}-${field.key}`}>{field.label}</Label>
          <Input
            id={`setup-${def.type}-${field.key}`}
            type={field.secret ? "password" : field.key === "endpointUrl" ? "url" : "text"}
            autoComplete="off"
            placeholder={field.key === "endpointUrl" ? placeholder : undefined}
            value={values[field.key] ?? ""}
            onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Saved encrypted when you click Save, read-only access. It is never kept in the setup draft.</p>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Button type="button" size="sm" disabled={missing || busy} onClick={() => void save()}>
        {busy ? "Saving..." : "Save and test"}
      </Button>
    </div>
  );
}

export function AiSreStep({ response, permissions, draft, patchDraft, readOnly }: StepProps) {
  // Accepted check-then-act: permissions are read once at load; the server actions re-check them on every call.
  const connectorIds = draft.aiSre?.connectorIds ?? [];
  const services = draft.aiSre?.services ?? [];
  const [open, setOpen] = useState<ConnectorType | null>(null);
  const [outcomes, setOutcomes] = useState<Array<{ type: ConnectorType; outcome: Outcome }>>([]);

  const host = draft.app?.url ? new URL(draft.app.url).host : null;
  const setAiSre = (next: { connectorIds?: string[]; services?: Array<{ name: string }> }) =>
    patchDraft((d) => ({ ...d, aiSre: { connectorIds: [], services: [], ...d.aiSre, ...next } }));

  if (!permissions.canConfigureConnectors && !permissions.canCreateServices) {
    return <Alert variant="info">Ask a project admin. Only project admins can connect tools for AI SRE.</Alert>;
  }

  // Merged inside patchDraft so a delayed callback never overwrites ids added since it started.
  const addIds = (ids: string[]) =>
    patchDraft((d) => ({ ...d, aiSre: { services: [], ...d.aiSre, connectorIds: [...new Set([...(d.aiSre?.connectorIds ?? []), ...ids])].slice(0, 20) } }));
  const earlier = connectorIds.length - outcomes.length;

  return (
    <div className="space-y-6">
      {permissions.canConfigureConnectors ? (
      <>
      <p className="text-sm text-muted-foreground">Connect the tools your team already uses, so AI SRE can look at deploys, errors and metrics when something breaks. Each one is saved and tested right away. Skip anything you do not use.</p>

      {outcomes.length > 0 || earlier > 0 ? (
        <section aria-label="Connected tools" className="space-y-2">
          <h3 className="text-sm font-semibold">Already set up</h3>
          <ul className="flex flex-wrap gap-2">
            {outcomes.map(({ type, outcome }, i) => (
              <li key={`${type}-${i}`} data-testid={`setup-connector-result-${type}`}>
                <TableBadge tone={outcome.state === "connected" ? "success" : "warning"}>
                  {labelOf(type)}: {outcome.state === "connected" ? "Connected" : outcome.state === "saved" ? "Saved, not tested" : "Saved, token rejected"}
                </TableBadge>
              </li>
            ))}
            {earlier > 0 ? <li className="text-xs text-muted-foreground">{earlier} saved earlier</li> : null}
          </ul>
          {outcomes.filter((o) => o.outcome.state !== "connected").map(({ type, outcome }, i) => (
            <Alert key={`${type}-${i}`} variant="warning">
              {labelOf(type)}: {outcome.text}
            </Alert>
          ))}
        </section>
      ) : null}

      {!readOnly ? (
        <section aria-label="Connect a tool" className="space-y-3">
          <div role="group" aria-label="Connector types" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTORS.map(({ type }) => (
              <Button
                key={type}
                type="button"
                variant="outline"
                aria-pressed={open === type}
                className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                onClick={() => setOpen(open === type ? null : type)}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{labelOf(type)}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{SRE_CONNECTOR_CATALOG.find((c) => c.value === type)?.description}</span>
                </span>
              </Button>
            ))}
          </div>
          {open ? (
            <ConnectorForm
              key={open}
              def={CONNECTORS.find((c) => c.type === open)!}
              projectId={response.projectId}
              knownIds={connectorIds}
              onSaved={(id, outcome) => {
                const savedType = open;
                setOutcomes((list) => [...list, { type: savedType, outcome }]);
                addIds([id]);
                // A save that finishes after the user opened another form must not close that one.
                setOpen((current) => (current === savedType ? null : current));
              }}
            />
          ) : null}
        </section>
      ) : null}

      <CopyFromProject kind="connectors" setupProjectId={response.projectId} disabled={readOnly} onCopied={addIds} />

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4" data-testid="setup-card-private-agent">
        <div className="flex min-w-0 items-start gap-3">
          <Radio className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold">Tools inside a private network?</h3>
            <p className="text-xs text-muted-foreground">A private agent reaches Kubernetes, internal Prometheus and similar tools. Register it in organization settings.</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/org-admin?tab=private-agents">Set up a private agent</Link>
        </Button>
      </section>

      </>
      ) : null}

      {permissions.canCreateServices ? (
      <section aria-labelledby="setup-services" className="space-y-2">
        <h3 id="setup-services" className="text-sm font-semibold">
          Services
        </h3>
        <p className="text-xs text-muted-foreground">A service groups monitors and tools, so incidents show who owns what. Review creates the ticked one.</p>
        {host ? (
          <div className="flex items-center gap-3 rounded-lg border px-4 py-2.5">
            <Checkbox
              id="setup-service-host"
              checked={services.some((s) => s.name === host)}
              disabled={readOnly}
              onCheckedChange={(checked) => setAiSre({ services: checked === true ? [...services, { name: host }] : services.filter((s) => s.name !== host) })}
            />
            <Label htmlFor="setup-service-host" className="text-sm font-normal">
              Create a service named {host}
            </Label>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Add your app URL in the first step to get a suggested service.</p>
        )}
        <Link href="/services" className="text-sm font-medium underline underline-offset-4">
          Manage services
        </Link>
      </section>
      ) : null}
    </div>
  );
}
