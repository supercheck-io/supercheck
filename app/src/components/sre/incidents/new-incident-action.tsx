"use client";

import { useState } from "react";
import { Plus, Siren } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DeclareIncidentDialog, type DeclareIncidentDefaults } from "@/components/sre/incidents/declare-incident-dialog";
import { checkRolePermissionsClient } from "@/lib/rbac/permissions-client";
import { useProjectContext } from "@/hooks/use-project-context";
import { AREA_TEXT, NAV } from "@/lib/nav-areas";

/**
 * "New incident" button (permission gated) plus the declare dialog. On the incidents page `?new=1`
 * (Quick Create and Cmd+K) opens it; service and monitor pages pass `defaults` and a "Declare incident" label.
 */
export function NewIncidentAction({ defaults, variant = "page" }: { defaults?: DeclareIncidentDefaults; variant?: "page" | "detail" }) {
  const router = useRouter();
  const pathname = usePathname();
  const { currentProject, loading: projectLoading, error: projectError } = useProjectContext();
  const canCreate = Boolean(
    !projectLoading &&
      !projectError &&
      currentProject?.userRole &&
      checkRolePermissionsClient(currentProject.userRole, { sre_incident: ["create"] }),
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const searchParams = useSearchParams();
  const requested = variant === "page" && searchParams.get("new") === "1";
  const open = canCreate && (dialogOpen || requested);
  const setOpen = (next: boolean) => {
    setDialogOpen(next);
    if (!next && requested) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }
  };

  if (variant === "detail" && !canCreate) return null;
  return (
    <>
      {variant === "page" && projectError && (
        <p role="status" className="text-sm text-muted-foreground">
          Permissions unavailable. Refresh to try again.
        </p>
      )}
      {(canCreate || (variant === "page" && projectLoading)) && (
        <Button
          type="button"
          variant={variant === "detail" ? "outline" : "default"}
          className="h-8"
          disabled={!canCreate}
          aria-busy={projectLoading || undefined}
          title={projectLoading ? "Loading permissions..." : undefined}
          onClick={() => setOpen(true)}
        >
          {variant === "detail" ? <Siren className={`h-4 w-4 ${AREA_TEXT[NAV.incidents.tone]}`} /> : <Plus className="h-4 w-4" />}
          {variant === "detail" ? "Declare incident" : "New incident"}
        </Button>
      )}
      {/* Mounted only while open, so each opening starts from the page's prefills. */}
      {open && <DeclareIncidentDialog open onOpenChange={setOpen} defaults={defaults} />}
    </>
  );
}
