"use client";

import { useState, useTransition, type FormEvent } from "react";
import { KeyRound, Loader2, Network, PlugZap, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  createSreConnector,
  type SreConnectorListItem,
  type SreConnectorSetupOptions,
} from "@/actions/sre-connectors";
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
import {
  isLiveSearchConnectorType,
  isPrivateAgentConnectorType,
} from "@/lib/sre/connectors/connector-capabilities";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableBadge } from "@/components/ui/table-badge";
import { SRE_CONNECTOR_CATALOG } from "./connector-catalog";
import { getConnectorQueryGuide } from "./connector-query-guides";

type ConnectorFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setupOptions: SreConnectorSetupOptions;
  onSaved: (connector: SreConnectorListItem) => void;
};

type ConnectorType = Parameters<typeof createSreConnector>[0]["type"];
type CredentialType = NonNullable<
  Parameters<typeof createSreConnector>[0]["credential"]
>["credentialType"];

const connectorTypeOptions = SRE_CONNECTOR_CATALOG.filter(
  (option) => option.addable,
);

const credentialTypeOptions: Array<{ value: CredentialType; label: string }> = [
  { value: "api_key", label: "API key" },
  { value: "bearer_token", label: "Bearer token" },
  { value: "service_account", label: "Service account" },
  { value: "oauth_token", label: "OAuth token" },
];

const apiKeyOnlyConnectorTypes = new Set<ConnectorType>([
  "gitlab",
  "pagerduty",
  "opsgenie",
]);

type FieldErrors = Record<string, string[] | undefined>;

function firstError(fieldErrors: FieldErrors | undefined, field: string) {
  return fieldErrors?.[field]?.[0] ?? null;
}

export function ConnectorFormDialog({
  open,
  onOpenChange,
  setupOptions,
  onSaved,
}: ConnectorFormDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>();
  const [name, setName] = useState("");
  const [type, setType] = useState<ConnectorType>("github");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [riskLevel, setRiskLevel] = useState<
    "low" | "medium" | "high" | "critical"
  >("low");
  const [executionMode, setExecutionMode] = useState<
    "direct" | "private_agent"
  >("direct");
  const [privateAgentId, setPrivateAgentId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [credentialType, setCredentialType] =
    useState<CredentialType>("api_key");
  const [credentialValue, setCredentialValue] = useState("");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsSessionToken, setAwsSessionToken] = useState("");
  const isCloudWatch = type === "aws_cloudwatch";
  const isApiKeyOnly = apiKeyOnlyConnectorTypes.has(type);
  const visibleCredentialTypeOptions = isApiKeyOnly
    ? credentialTypeOptions.filter((option) => option.value === "api_key")
    : credentialTypeOptions;
  const supportsPrivateAgent = isPrivateAgentConnectorType(type);
  const selectedTypeOption = connectorTypeOptions.find(
    (option) => option.value === type,
  );
  const isLiveSearchType = isLiveSearchConnectorType(type);
  const queryGuide = getConnectorQueryGuide(type);

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedCredential = credentialValue.trim();
    const trimmedAwsAccessKeyId = awsAccessKeyId.trim();
    const trimmedAwsSecretAccessKey = awsSecretAccessKey.trim();
    const trimmedAwsSessionToken = awsSessionToken.trim();

    startTransition(async () => {
      const result = await createSreConnector({
        name,
        type,
        endpointUrl,
        riskLevel,
        privateAgentId:
          executionMode === "private_agent" ? privateAgentId : null,
        serviceIds: selectedServiceIds,
        defaultTimeWindowMinutes: 60,
        outputLimits: { maxRows: 100, maxBytes: 1_048_576, maxSeconds: 10 },
        credential:
          isCloudWatch && trimmedAwsAccessKeyId && trimmedAwsSecretAccessKey
            ? {
                credentialType: "api_key",
                value: {
                  apiKey: trimmedAwsAccessKeyId,
                  secret: trimmedAwsSecretAccessKey,
                  ...(trimmedAwsSessionToken
                    ? { sessionToken: trimmedAwsSessionToken }
                    : {}),
                },
              }
            : trimmedCredential
              ? {
                  credentialType,
                  value: { secret: trimmedCredential },
                }
              : undefined,
      });

      if (!result.success) {
        setFieldErrors(result.fieldErrors);
        toast.error(result.error);
        return;
      }

      if (result.connector) {
        onSaved(result.connector);
      }

      toast.success(result.message);
      setCredentialValue("");
      setAwsAccessKeyId("");
      setAwsSecretAccessKey("");
      setAwsSessionToken("");
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-1rem)] w-[calc(100vw-1rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-h-[min(92svh,920px)] sm:w-[calc(100vw-2rem)] sm:max-w-none xl:w-auto xl:min-w-[80rem] xl:max-w-[80rem]">
        <DialogHeader className="border-b px-5 py-5 sm:px-8">
          <DialogTitle className="text-xl">Add connector</DialogTitle>
          <DialogDescription>
            Connect a read-only evidence source. Credentials stay encrypted and
            are never included in AI prompts or responses.
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 [scrollbar-width:thin] sm:px-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-8">
              <section className="space-y-5 xl:border-r xl:pr-8">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                    1
                  </span>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <PlugZap className="h-4 w-4 text-muted-foreground" />
                      Connection
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Choose the source, ownership label, and network path.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="connector-type">Connector type</Label>
                    <Select
                      value={type}
                      onValueChange={(value) => {
                        const nextType = value as ConnectorType;
                        setType(nextType);
                        if (apiKeyOnlyConnectorTypes.has(nextType)) {
                          setCredentialType("api_key");
                        }
                        if (!isPrivateAgentConnectorType(nextType)) {
                          setExecutionMode("direct");
                          setPrivateAgentId(null);
                        }
                      }}
                    >
                      <SelectTrigger id="connector-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {connectorTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                        {selectedTypeOption?.description}
                      </p>
                      <TableBadge
                        tone={isLiveSearchType ? "success" : "warning"}
                        compact
                        className="shrink-0"
                      >
                        {isLiveSearchType ? "Live search" : "Setup only"}
                      </TableBadge>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="connector-name">Name *</Label>
                    <Input
                      id="connector-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={`Production ${selectedTypeOption?.label ?? "connector"}`}
                      aria-invalid={Boolean(firstError(fieldErrors, "name"))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Use a name responders will recognize in evidence
                      citations.
                    </p>
                    {firstError(fieldErrors, "name") && (
                      <p className="text-xs text-destructive">
                        {firstError(fieldErrors, "name")}
                      </p>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="connector-risk">Risk level</Label>
                    <Select
                      value={riskLevel}
                      onValueChange={(value) =>
                        setRiskLevel(value as typeof riskLevel)
                      }
                    >
                      <SelectTrigger id="connector-risk" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Classifies the sensitivity of evidence returned by this
                      source.
                    </p>
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="connector-execution">Execution mode</Label>
                    <Select
                      value={executionMode}
                      onValueChange={(value) =>
                        setExecutionMode(value as typeof executionMode)
                      }
                    >
                      <SelectTrigger
                        id="connector-execution"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem
                          value="private_agent"
                          disabled={
                            setupOptions.privateAgents.length === 0 ||
                            !supportsPrivateAgent
                          }
                        >
                          Private Agent
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {supportsPrivateAgent
                        ? "Direct reaches public APIs. Private Agent reaches internal services."
                        : `${selectedTypeOption?.label ?? "This connector"} currently supports direct execution only.`}
                    </p>
                  </div>

                  {executionMode === "private_agent" && (
                    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="private-agent">Private Agent</Label>
                      <Select
                        value={privateAgentId ?? undefined}
                        onValueChange={setPrivateAgentId}
                      >
                        <SelectTrigger id="private-agent" className="w-full">
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {setupOptions.privateAgents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              {agent.name} ({agent.status})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                    2
                  </span>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <KeyRound className="h-4 w-4 text-muted-foreground" />
                      Endpoint and read-only access
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Add the endpoint and least-privilege credential used for
                      evidence queries.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor="connector-endpoint">Endpoint URL</Label>
                    <Input
                      id="connector-endpoint"
                      value={endpointUrl}
                      onChange={(event) => setEndpointUrl(event.target.value)}
                      placeholder={queryGuide.endpointPlaceholder}
                      aria-invalid={Boolean(
                        firstError(fieldErrors, "endpointUrl"),
                      )}
                    />
                    {firstError(fieldErrors, "endpointUrl") ? (
                      <p className="text-xs text-destructive">
                        {firstError(fieldErrors, "endpointUrl")}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Must be reachable from the selected execution mode.
                      </p>
                    )}
                    {endpointUrl &&
                      /^(https?:\/\/)?(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|.*\.svc|.*\.local)(:\d+)?(\/.*)?$/.test(
                        endpointUrl,
                      ) &&
                      executionMode === "direct" && (
                        <div className="mt-1 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                          <Network className="h-4 w-4 shrink-0" />
                          <p>
                            This appears to be an internal address. Select
                            Private Agent so Supercheck can reach it without
                            exposing the service publicly.
                          </p>
                        </div>
                      )}
                  </div>

                  {isCloudWatch ? (
                    <>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="aws-access-key-id">
                          AWS access key ID
                        </Label>
                        <Input
                          id="aws-access-key-id"
                          value={awsAccessKeyId}
                          onChange={(event) =>
                            setAwsAccessKeyId(event.target.value)
                          }
                          type="password"
                          autoComplete="new-password"
                          placeholder="AKIA..."
                        />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="aws-secret-access-key">
                          AWS secret access key
                        </Label>
                        <Input
                          id="aws-secret-access-key"
                          value={awsSecretAccessKey}
                          onChange={(event) =>
                            setAwsSecretAccessKey(event.target.value)
                          }
                          type="password"
                          autoComplete="new-password"
                          placeholder="Paste read-only secret"
                        />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor="aws-session-token">
                          AWS session token
                        </Label>
                        <Input
                          id="aws-session-token"
                          value={awsSessionToken}
                          onChange={(event) =>
                            setAwsSessionToken(event.target.value)
                          }
                          type="password"
                          autoComplete="new-password"
                          placeholder="Optional STS token"
                        />
                        <p className="text-xs text-muted-foreground">
                          {queryGuide.credentialHint}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="credential-type">Credential type</Label>
                        <Select
                          value={credentialType}
                          onValueChange={(value) =>
                            setCredentialType(value as CredentialType)
                          }
                        >
                          <SelectTrigger
                            id="credential-type"
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {visibleCredentialTypeOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor="credential-value">
                          Credential value
                        </Label>
                        <Input
                          id="credential-value"
                          value={credentialValue}
                          onChange={(event) =>
                            setCredentialValue(event.target.value)
                          }
                          type="password"
                          autoComplete="new-password"
                          placeholder="Paste read-only credential"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        {queryGuide.credentialHint}
                      </p>
                    </>
                  )}
                </div>
              </section>

              <section className="space-y-4 border-t pt-6 xl:col-span-2">
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                    3
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Service scope</p>
                    <p className="text-xs text-muted-foreground">
                      Optional. Restrict evidence access to specific services;
                      leave empty only for intentional organization-wide access.
                    </p>
                  </div>
                </div>

                {setupOptions.services.length === 0 ? (
                  <div className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                    No active services are available. Add a service before
                    applying connector scope.
                  </div>
                ) : (
                  <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border bg-muted/10 p-2 sm:grid-cols-2 xl:grid-cols-3">
                    {setupOptions.services.map((service) => (
                      <label
                        key={service.id}
                        className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md p-2.5 transition-colors hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={selectedServiceIds.includes(service.id)}
                          onCheckedChange={() => toggleService(service.id)}
                          aria-label={`Scope connector to ${service.name}`}
                        />
                        <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                          <span className="truncate font-medium">
                            {service.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {[service.environment, service.ownerTeam]
                              .filter(Boolean)
                              .join(" · ") || "No metadata"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>

          <DialogFooter className="!flex-col gap-3 border-t px-5 py-4 sm:!flex-row sm:!items-center sm:!justify-between sm:px-8">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Read-only, bounded, service-scoped, redacted, and audited.
              </span>
            </div>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add connector
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
