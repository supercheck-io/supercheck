"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
 * Generates the bounded HTTP workload a trial may run. Domain ownership is not
 * required: the trial allowance (VUs x duration) is what keeps usage metered.
 * Paid plans are not shown this card and can run any k6 script.
 */
export function TrialLoadTesting({ canManage }: { canManage: boolean }) {
  const { data: status } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: fetchSubscriptionStatus,
    staleTime: 60_000,
  });
  const trialActive = !!status?.trial?.active && !status.isActive;

  const [url, setUrl] = useState("");
  const [vus, setVus] = useState("2");
  const [durationSeconds, setDurationSeconds] = useState("60");
  const [script, setScript] = useState("");
  const [copied, setCopied] = useState(false);

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
        <CardTitle className="text-base">Trial load testing</CardTitle>
        <p className="text-sm text-muted-foreground">
          Trials can run a generated HTTPS GET workload with up to 5 VUs,
          5 minutes per run, and 150 VU-minutes total. No DNS setup is needed.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
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
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="trial-generated-script">
                  Generated k6 script
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copy}
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy script"}
                </Button>
              </div>
              <textarea
                id="trial-generated-script"
                readOnly
                value={script}
                aria-label="Generated k6 script"
                className="min-h-40 w-full rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
              />
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
