"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { generateSreEvidenceBrief } from "@/actions/sre-evidence";
import { Button } from "@/components/ui/button";

type GenerateEvidenceBriefButtonProps = {
  incidentId: string;
  hasBrief: boolean;
};

export function GenerateEvidenceBriefButton({ incidentId, hasBrief }: GenerateEvidenceBriefButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await generateSreEvidenceBrief({ incidentId });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message, {
        description: `${result.evidenceCount} native evidence item${result.evidenceCount === 1 ? "" : "s"} available`,
      });
      router.refresh();
    });
  };

  return (
    <Button onClick={handleClick} disabled={isPending}>
      {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
      {hasBrief ? "Regenerate native brief" : "Generate native brief"}
    </Button>
  );
}
