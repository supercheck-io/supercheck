"use client";

import type * as React from "react";
import { UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0]?.toUpperCase()).join("") || "?";
}

/** Round avatar: the photo, else initials, else a dashed person icon when nobody is set. */
export function UserAvatar({
  name,
  image,
  className,
  ...props
}: {
  name: string | null | undefined;
  image?: string | null;
  className?: string;
} & Omit<React.ComponentProps<typeof Avatar>, "children">) {
  return (
    // Initials scale with the avatar size (container query), so one component fits 16px to 64px.
    <Avatar className={cn("@container h-6 w-6", className)} {...props}>
      {name && image ? <AvatarImage src={image} alt="" /> : null}
      <AvatarFallback className={cn("text-[40cqw] font-medium", !name && "border border-dashed bg-transparent text-muted-foreground")}>
        {name ? initials(name) : <UserRound className="h-3/5 w-3/5" aria-hidden="true" />}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * One-line person: avatar plus name, with the email in a tooltip. Used wherever a
 * user is shown, so people look the same in tables, cards and timelines.
 */
export function UserCell({
  name,
  email,
  image,
  emptyLabel = "Unassigned",
  className,
  avatarClassName,
}: {
  name: string | null | undefined;
  email?: string | null;
  image?: string | null;
  emptyLabel?: string;
  className?: string;
  avatarClassName?: string;
}) {
  const label = name || email || null;
  const content = (
    <div className={cn("flex min-w-0 items-center gap-2", !label && "text-muted-foreground", className)}>
      <UserAvatar name={label} image={image} className={avatarClassName} />
      <span className="truncate text-sm">{label ?? emptyLabel}</span>
    </div>
  );
  if (!email || !name) return content;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>{email}</TooltipContent>
    </Tooltip>
  );
}
