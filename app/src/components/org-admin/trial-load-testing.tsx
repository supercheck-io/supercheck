"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SUBSCRIPTION_STATUS_QUERY_KEY,
  fetchSubscriptionStatus,
} from "@/components/subscription-guard";

interface TargetDomain {
  id: string;
  hostname: string;
  verifiedAt: string | null;
  verifiedUntil: string | null;
  txtName: string;
  txtValue: string;
}

const DOMAINS_KEY = ["trial-target-domains"] as const;

async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error ?? "Something went wrong. Please try again.");
  return payload as T;
}

/**
 * Lets an organization admin prove ownership of a domain and generate the k6
 * script a trial may run against it. Shown only during an active trial; paid
 * plans run their own k6 scripts and need neither.
 */
export function TrialLoadTesting({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: fetchSubscriptionStatus,
    staleTime: 60_000,
  });
  const trialActive = !!status?.trial?.active && !status.isActive;

  const { data: domains = [] } = useQuery({
    queryKey: DOMAINS_KEY,
    queryFn: async () =>
      (await call<{ data: TargetDomain[] }>("/api/execution/target-domains"))
        .data,
    enabled: trialActive && canManage,
  });

  const [hostname, setHostname] = useState("");
  const [url, setUrl] = useState("");
  const [vus, setVus] = useState("2");
  const [durationSeconds, setDurationSeconds] = useState("60");
  const [script, setScript] = useState("");
  const [copied, setCopied] = useState(false);

  const mutate = useMutation({
    mutationFn: (body: {
      action: "register" | "verify" | "remove";
      hostname?: string;
      id?: string;
    }) => call("/api/execution/target-domains", body),
    onSuccess: (_data, body) => {
      setHostname("");
      toast.success(
        body.action === "verify"
          ? "Domain verified"
          : body.action === "remove"
            ? "Domain removed"
            : "Domain added",
      );
      return queryClient.invalidateQueries({ queryKey: DOMAINS_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generate = useMutation({
    mutationFn: () =>
      call<{ script: string }>("/api/execution/trial-workload", {
        url,
        vus: Number(vus),
        durationSeconds: Number(durationSeconds),
      }),
    onSuccess: (result) => setScript(result.script),
    onError: (error: Error) => toast.error(error.message),
  });

  if (!trialActive || !canManage) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Load testing during your trial
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          To protect other people&apos;s sites, a trial can load test only
          domains you own. Add a domain, publish the DNS record shown, then
          verify it. You then generate the k6 script here and use it in a
          performance test.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <section aria-labelledby="trial-domains" className="space-y-3">
          <h3 id="trial-domains" className="text-sm font-medium">
            Your domains
          </h3>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (hostname.trim())
                mutate.mutate({
                  action: "register",
                  hostname: hostname.trim(),
                });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="trial-hostname">Domain</Label>
              <Input
                id="trial-hostname"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder="app.example.com"
              />
            </div>
            <Button
              type="submit"
              disabled={mutate.isPending || !hostname.trim()}
            >
              Add domain
            </Button>
          </form>
          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No domains yet.</p>
          ) : (
            <ul className="space-y-3">
              {domains.map((domain) => (
                <li
                  key={domain.id}
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{domain.hostname}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {domain.verifiedAt ? "Verified" : "Not verified"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutate.isPending}
                        onClick={() =>
                          mutate.mutate({ action: "verify", id: domain.id })
                        }
                      >
                        {domain.verifiedAt ? "Re-verify" : "Verify"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={mutate.isPending}
                        onClick={() =>
                          mutate.mutate({ action: "remove", id: domain.id })
                        }
                      >
                        Remove
                      </Button>
                    </span>
                  </div>
                  {!domain.verifiedAt && (
                    <p className="text-xs text-muted-foreground">
                      Add a TXT record named{" "}
                      <code className="break-all">{domain.txtName}</code> with
                      the value{" "}
                      <code className="break-all">{domain.txtValue}</code>, then
                      select Verify.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="trial-script" className="space-y-3">
          <h3 id="trial-script" className="text-sm font-medium">
            Generate a load test
          </h3>
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              generate.mutate();
            }}
          >
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="trial-url">HTTPS URL</Label>
              <Input
                id="trial-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://app.example.com/health"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="trial-vus">Users (1 to 5)</Label>
              <Input
                id="trial-vus"
                type="number"
                min={1}
                max={5}
                value={vus}
                onChange={(event) => setVus(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="trial-duration">Seconds (up to 300)</Label>
              <Input
                id="trial-duration"
                type="number"
                min={1}
                max={300}
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(event.target.value)}
              />
            </div>
            <div className="sm:col-span-4">
              <Button
                type="submit"
                disabled={generate.isPending || !url.trim()}
              >
                Generate script
              </Button>
            </div>
          </form>
          {script && (
            <div className="space-y-2">
              <pre
                aria-label="Generated k6 script"
                className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs"
              >
                {script}
              </pre>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy script"}
              </Button>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
