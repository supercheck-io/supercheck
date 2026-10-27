import { UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]?.toUpperCase()).join("") || "?";
}

/** Round avatar for an incident assignee or commander; a dashed person icon when nobody is set. */
export function IncidentPersonAvatar({
  name,
  image,
  className,
}: {
  name: string | null;
  image?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("h-6 w-6", className)}>
      {name && image ? <AvatarImage src={image} alt="" /> : null}
      <AvatarFallback className={cn("text-[10px]", !name && "border border-dashed bg-transparent text-muted-foreground")}>
        {name ? initials(name) : <UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
      </AvatarFallback>
    </Avatar>
  );
}
