import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getStatusPageSupportContact,
  getStatusPageSupportCtaLabel,
} from "@/lib/status-page-support";
import { LifeBuoy, Mail } from "lucide-react";

type SupportContactButtonProps = {
  supportUrl?: string | null;
  language?: string | null;
  className?: string;
};

export function SupportContactButton({
  supportUrl,
  language,
  className,
}: SupportContactButtonProps) {
  const supportContact = getStatusPageSupportContact(supportUrl);

  if (!supportContact) {
    return null;
  }

  const SupportIcon = supportContact.kind === "email" ? Mail : LifeBuoy;
  const label = getStatusPageSupportCtaLabel(language);
  const ariaLabel =
    supportContact.kind === "email"
      ? `${label}: ${supportContact.value}`
      : `${label}: ${supportContact.href}`;

  return (
    <Button
      asChild
      variant="outline"
      className={cn("gap-2 shadow-sm w-full sm:w-auto", className)}
    >
      <a
        href={supportContact.href}
        target={supportContact.kind === "url" ? "_blank" : undefined}
        rel={
          supportContact.kind === "url" ? "noopener noreferrer" : undefined
        }
        aria-label={ariaLabel}
        title={supportContact.value}
      >
        <SupportIcon className="h-4 w-4" />
        {label}
      </a>
    </Button>
  );
}
