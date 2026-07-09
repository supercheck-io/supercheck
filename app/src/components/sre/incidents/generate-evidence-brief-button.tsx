"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { generateSreEvidenceBrief } from "@/actions/sre-evidence";
import { Button } from "@/components/ui/button";

type GenerateEvidenceBriefButtonProps = {
  incidentId: string;
  hasBrief: boolean;
  onStreamStart?: () => void;
  onStreamContent?: (chunk: string) => void;
  onStreamDone?: (result: {
    message?: string;
    brief?: {
      summary: string;
      provider: "ai" | "fallback";
      confidenceScore: number;
    };
  }) => void;
  onStreamError?: (message: string) => void;
};

function errorMessage(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (value instanceof Error && value.message) {
    return value.message;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }

  return fallback;
}

export function GenerateEvidenceBriefButton({
  incidentId,
  hasBrief,
  onStreamStart,
  onStreamContent,
  onStreamDone,
  onStreamError,
}: GenerateEvidenceBriefButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleClick = async () => {
    setIsPending(true);
    try {
      if (onStreamStart && onStreamContent && onStreamDone) {
        try {
          onStreamStart();

          const response = await fetch("/api/sre/evidence-brief/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentId }),
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(
              errorMessage(payload, "Failed to generate brief"),
            );
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("Streaming response unavailable");
          }

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) {
                continue;
              }

              const data = JSON.parse(line.slice(6)) as {
                type: "content" | "done" | "error";
                content?: string;
                error?: unknown;
                message?: string;
                brief?: {
                  summary: string;
                  provider: "ai" | "fallback";
                  confidenceScore: number;
                };
              };

              if (data.type === "content" && data.content) {
                onStreamContent(data.content);
              } else if (data.type === "done") {
                onStreamDone(data);
                toast.success(data.message ?? "Evidence brief generated");
                router.refresh();
              } else if (data.type === "error") {
                throw new Error(
                  errorMessage(data.error, "Failed to generate brief"),
                );
              }
            }
          }
        } catch (error) {
          const message = errorMessage(
            error,
            "Failed to generate evidence brief",
          );
          onStreamError?.(message);
          toast.error(message);
        }
        return;
      }

      const result = await generateSreEvidenceBrief({ incidentId });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message, {
        description: `${result.evidenceCount} native evidence item${result.evidenceCount === 1 ? "" : "s"} available`,
      });
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={isPending}>
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="mr-2 h-4 w-4" />
      )}
      {hasBrief ? "Regenerate brief" : "Generate brief"}
    </Button>
  );
}
