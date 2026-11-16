"use client";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { StepProps } from "./step-types";

export function InviteStep({ permissions }: StepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">People you invite can finish the parts they own, like tests or alerts. You can keep going while they join.</p>
      {permissions.canInvite ? (
        <Button asChild variant="outline">
          <Link href="/org-admin?tab=members">Invite people</Link>
        </Button>
      ) : (
        <Alert variant="info">Ask an org admin to invite people. Only org admins can send invitations.</Alert>
      )}
    </div>
  );
}
