"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import catalog from "@/lib/billing/plan-catalog.json";

export interface TeamMemberSeats {
  current: number;
  limit: number;
  included?: number;
  purchasedSeats?: number | null;
  extraMemberPriceCents?: number;
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The monthly change of moving from `limit` to `next` seats, as shown before buying. */
export function seatChangePreview(seats: Required<Pick<TeamMemberSeats, "limit" | "included" | "extraMemberPriceCents">>, next: number) {
  const extra = (total: number) => Math.max(0, total - seats.included);
  const deltaSeats = extra(next) - extra(seats.limit);
  const deltaCents = deltaSeats * seats.extraMemberPriceCents;
  if (next === seats.limit) return "No change.";
  if (deltaSeats === 0) return `${next} members are included in Pro at no extra cost.`;
  return deltaSeats > 0
    ? `Add ${deltaSeats} ${deltaSeats === 1 ? "member" : "members"}: +${dollars(deltaCents)}/month. The prorated charge for the rest of this billing period is invoiced now.`
    : `Remove ${-deltaSeats} ${deltaSeats === -1 ? "seat" : "seats"}: -${dollars(-deltaCents)}/month. The unused time is credited to your next invoice.`;
}

/** Member seat summary for the subscription tab, with a seat dialog for Pro owners and admins. */
export function MemberSeats({
  organizationId,
  plan,
  seats,
  canManage,
  onSaved,
}: {
  organizationId?: string;
  plan: "plus" | "pro" | "unlimited" | null;
  seats: TeamMemberSeats;
  canManage: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(seats.limit));
  const [saving, setSaving] = useState(false);

  if (plan === "plus") {
    return (
      <p className="text-sm text-muted-foreground">
        Need more than {seats.limit} members? {catalog.pro.name} includes {catalog.pro.limits.maxTeamMembers}, and extra
        members are {dollars(catalog.pro.extraMemberPriceCents)} per member per month.
      </p>
    );
  }
  if (plan !== "pro" || seats.included === undefined || seats.extraMemberPriceCents === undefined) return null;

  const included = seats.included;
  const price = seats.extraMemberPriceCents;
  const extra = Math.max(0, seats.limit - included);
  const floor = Math.max(included, seats.current);
  const next = Number(value);
  const valid = Number.isInteger(next) && next >= floor && next <= 1000;

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/billing/members", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, totalMembers: next }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not change member seats");
      toast.success("Member seats updated");
      setOpen(false);
      await onSaved();
    } catch (error) {
      toast.error("Could not change member seats", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-muted-foreground">
        Members: {seats.current} / {seats.limit} ({included} included
        {extra > 0 ? ` + ${extra} extra at ${dollars(price)}/month each` : `; extra members ${dollars(price)}/month each`})
      </p>
      {canManage && (
        <Button variant="outline" size="sm" onClick={() => { setValue(String(seats.limit)); setOpen(true); }}>
          Change member seats
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change member seats</DialogTitle>
            <DialogDescription>
              Pro includes {included} members. Each extra member is {dollars(price)} per month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="member-seats">Total members</Label>
            <Input
              id="member-seats"
              type="number"
              inputMode="numeric"
              min={floor}
              max={1000}
              step={1}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {valid
                ? seatChangePreview({ limit: seats.limit, included, extraMemberPriceCents: price }, next)
                : `Choose a whole number from ${floor} to 1,000. You can't go below the members and pending invitations you have now.`}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={!valid || next === seats.limit || saving}>
              {saving ? "Saving..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
