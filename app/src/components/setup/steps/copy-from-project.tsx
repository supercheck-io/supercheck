"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBadge } from "@/components/ui/table-badge";
import { useProjectContextSafe } from "@/hooks/use-project-context";
import { postJson, responseError } from "./step-types";

type Kind = "providers" | "connectors";

interface CopyItem {
  sourceId: string;
  id?: string;
  status: "copied" | "adopted" | "failed";
  error?: string;
  name?: string;
}

const NOUN: Record<Kind, { all: string; one: string }> = {
  providers: { all: "alert channels", one: "Alert channel" },
  connectors: { all: "connectors", one: "Connector" },
};
/** Roles that may read the source's config (notification:update) or configure its connectors. */
const BLOCKED_SOURCE_ROLES: Record<Kind, string[]> = {
  providers: ["project_viewer"],
  connectors: ["project_viewer", "project_editor"],
};

const STATUS: Record<CopyItem["status"], { word: string; tone: "success" | "info" | "danger" }> = {
  copied: { word: "Copied", tone: "success" },
  adopted: { word: "Already there", tone: "info" },
  failed: { word: "Failed", tone: "danger" },
};

/** Second-project shortcut: copy every alert channel or connector of another project (spec 7). */
export function CopyFromProject({ kind, setupProjectId, disabled, capacity, onCopied }: { kind: Kind; setupProjectId: string; disabled: boolean; /** Room left in the draft: the copy is limited to it so no copied item is dropped. */ capacity?: number; onCopied: (ids: string[]) => void }) {
  const ctx = useProjectContextSafe();
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<CopyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const org = ctx?.projects.find((p) => p.id === setupProjectId)?.organizationId;
  const sources = (ctx?.projects ?? []).filter((p) => p.id !== setupProjectId && p.organizationId === org && !BLOCKED_SOURCE_ROLES[kind].includes(p.userRole));
  if (sources.length === 0) return null;
  const source = sources.find((p) => p.id === sourceId);
  const noun = NOUN[kind];

  const copy = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<Partial<Record<Kind, CopyItem[]>>>(`/api/projects/${setupProjectId}/setup/copy`, {
        sourceProjectId: sourceId,
        [kind === "providers" ? "allProviders" : "allConnectors"]: true,
        ...(capacity !== undefined ? { limit: capacity } : {}),
      });
      const result = res.data[kind];
      if (!res.ok || !result) {
        setError(responseError(res.data, `Could not copy ${noun.all}.`));
      } else {
        setItems(result);
        onCopied(result.flatMap((item) => (item.id && item.status !== "failed" ? [item.id] : [])));
      }
    } catch {
      setError(`Could not copy ${noun.all}. Check your connection and try again.`);
    }
    setBusy(false);
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid={`setup-copy-${kind}`}>
      <div>
        <h3 className="text-sm font-semibold">Copy from a project</h3>
        <p className="text-xs text-muted-foreground">Reuse the {noun.all} you already set up. Secrets are copied encrypted and never shown.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 space-y-1.5">
          <Label htmlFor={`setup-copy-source-${kind}`}>Project</Label>
          <Select value={sourceId} disabled={disabled || busy} onValueChange={setSourceId}>
            <SelectTrigger id={`setup-copy-source-${kind}`} className="w-full">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" disabled={disabled || busy || !source || capacity === 0} onClick={() => void copy()}>
          {busy ? "Copying..." : source ? `Copy all ${noun.all} from ${source.name}` : `Copy all ${noun.all}`}
        </Button>
      </div>
      {capacity !== undefined && capacity < 10 ? (
        <p className="text-xs text-muted-foreground">{capacity === 0 ? `Setup keeps up to 10 ${noun.all}, and that limit is reached.` : `Setup keeps up to 10 ${noun.all}, so at most ${capacity} will be copied.`}</p>
      ) : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {items ? (
        items.length === 0 ? (
          <p className="text-sm text-muted-foreground">That project has no {noun.all} to copy.</p>
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Copy results">
            {items.map((item, index) => (
              <li key={item.sourceId} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {item.name ?? `${noun.one} ${index + 1}`}
                  {item.error ? <span className="block text-xs text-failure">{item.error}</span> : null}
                </span>
                <TableBadge tone={STATUS[item.status].tone} compact>
                  {STATUS[item.status].word}
                </TableBadge>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
